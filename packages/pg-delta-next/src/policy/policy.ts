/**
 * Policy DSL v2: filtering, serialization parameters, and policy composition
 * (target-architecture §3.9, stage-08-policy).
 *
 * Predicates are PURE DATA — no function-valued fields — so policies are
 * fully serializable to JSON and embeddable in plan artifacts (policyId +
 * inline policy for reproducibility).
 *
 * Evaluation model:
 *   - Filter rules: first-match-wins; no match → include.
 *   - Serialize rules: first-match-wins; contributes params once matched.
 *   - extends composition: own rules first, parent rules appended after.
 *   - Cycle detection by policy id; detected cycles throw.
 *
 * ## Deliberate vocabulary extensions (stage-8 pitfall: extend deliberately and log)
 *
 * The following predicates were added to support the Supabase policy rules that
 * could not be expressed with the initial vocabulary:
 *
 * ### `{ owner: string | string[] }`
 * Matches when `fact.payload["owner"]` is a string matching any of the given
 * globs. Needed for: excluding objects whose owner is a Supabase system role
 * (the old "star/owner" deny-list rule in supabase.ts).
 *
 * ### `{ idField: { field: string; glob: string | string[] } }`
 * Generic identity-field matcher: reads `(fact.id as Record<string, unknown>)[field]`,
 * then checks it is a string matching any glob. Covers:
 *   - `member` on membership facts (exclude memberships where member is a system role)
 *   - `role` on membership facts (exclude memberships where role is a system role)
 *   - `table` on trigger/policy/etc. (filter triggers on pgmq queue tables)
 *
 * ### `{ targetKind: string | string[] }`
 * For satellite facts whose id has a `target: StableId` field (acl, comment,
 * securityLabel): matches when `target.kind` is one of the given values.
 * Needed for: excluding ACL facts on FDWs (targetKind "fdw").
 *
 * ### `{ targetSchema: string | string[] }`
 * For satellite facts whose id has a `target: StableId` field (acl, comment,
 * securityLabel): matches when the target's `schema` field matches any glob.
 * Needed for: excluding ACL/comment satellites whose target lives in a system
 * schema (the old engine filtered these implicitly via parent object exclusion).
 *
 * ### `{ targetName: string | string[] }`
 * For satellite facts whose id has a `target: StableId` field (acl, comment,
 * securityLabel): matches when the target's `name` field matches any glob.
 * Needed for: excluding ACL/comment satellites on schema-kind targets (which
 * use `name` not `schema` in their StableId). Companion to targetSchema for
 * simple-kind targets like schema, role, extension, fdw, server.
 *
 * ### `{ edgeTo: { kind?: string; schema?: string | string[] } }`
 * Matches when the fact has an outgoing dependency edge (fb.outgoingEdges) to
 * a fact whose id.kind equals `kind` (if given) and/or whose id `schema` field
 * matches any glob (if given). Needed for: detecting user-created triggers whose
 * function lives in a non-managed schema (edgeTo {kind: "procedure", schema: not
 * in SYSTEM_SCHEMAS}), and for provenance filtering of extension-owned servers.
 */

import type { Delta } from "../core/diff.ts";
import type { DependencyEdge, Fact, FactBase } from "../core/fact.ts";
import type { FactKind, StableId } from "../core/stable-id.ts";
import { KNOWN_PARAMS, type PlanParams } from "../plan/rules.ts";

// ---------------------------------------------------------------------------
// Predicate vocabulary
// ---------------------------------------------------------------------------

/** Match by fact kind (one or many). */
export type KindPredicate = { kind: string | string[] };

/**
 * Match by identity field "schema" (glob supported, * = any sequence).
 * Accepts a single glob string OR an array of globs (matches if any glob matches).
 */
export type SchemaPredicate = { schema: string | string[] };

/**
 * Match by identity field "name" (glob supported).
 * Accepts a single glob string OR an array of globs (matches if any glob matches).
 */
export type NamePredicate = { name: string | string[] };

/** Match by delta verb. */
export type VerbPredicate = {
  verb:
    | "add"
    | "remove"
    | "set"
    | "link"
    | "unlink"
    | Array<"add" | "remove" | "set" | "link" | "unlink">;
};

/**
 * Match when the fact (or for satellite facts, some fact in its parent chain)
 * has an outgoing "memberOfExtension" edge to an extension fact with the given
 * name. Uses FactBase.outgoingEdges.
 */
export type OwnedByExtensionPredicate = { ownedByExtension: string };

/** Match when the fact's parent id has the given kind. */
export type ParentKindPredicate = { parentKind: string };

/** All sub-predicates must match. */
export type AllPredicate = { all: Predicate[] };

/** At least one sub-predicate must match. */
export type AnyPredicate = { any: Predicate[] };

/** Negate the sub-predicate. */
export type NotPredicate = { not: Predicate };

/**
 * Match when `fact.payload["owner"]` is a string matching any of the given
 * globs. Added for the Supabase system-role owner exclusion rule.
 */
export type OwnerPredicate = { owner: string | string[] };

/**
 * Generic identity-field matcher: reads `(fact.id as Record<string, unknown>)[field]`,
 * then checks it is a string matching any of the given globs.
 * Added for membership.member, membership.role, trigger.table, etc.
 */
export type IdFieldPredicate = {
  idField: { field: string; glob: string | string[] };
};

/**
 * For satellite facts (acl, comment, securityLabel) whose id has a
 * `target: StableId` field: matches when `target.kind` is one of the given values.
 * Added for excluding ACLs on FDW objects.
 */
export type TargetKindPredicate = { targetKind: string | string[] };

/**
 * For satellite facts (acl, comment, securityLabel) whose id has a
 * `target: StableId` field: matches when the target's `schema` field matches
 * any glob. Added for excluding ACL/comment satellites in system schemas.
 * Note: does NOT match schema-kind targets (which have `name` not `schema`);
 * use targetName for that case.
 */
export type TargetSchemaPredicate = { targetSchema: string | string[] };

/**
 * For satellite facts (acl, comment, securityLabel) whose id has a
 * `target: StableId` field: matches when the target's `name` field matches
 * any glob. Added for excluding ACL/comment satellites on schema objects
 * (which use `name` rather than `schema` in their StableId).
 */
export type TargetNamePredicate = { targetName: string | string[] };

/**
 * Matches when the fact has an outgoing dependency edge (fb.outgoingEdges)
 * to a fact whose id.kind equals `kind` (if given) and/or whose id `schema`
 * field matches any glob (if given).
 * Added for user-trigger detection (edgeTo non-system procedure schema) and
 * extension-provenance filtering.
 */
export type EdgeToPredicate = {
  edgeTo: { kind?: string; schema?: string | string[] };
};

export type Predicate =
  | KindPredicate
  | SchemaPredicate
  | NamePredicate
  | VerbPredicate
  | OwnedByExtensionPredicate
  | ParentKindPredicate
  | AllPredicate
  | AnyPredicate
  | NotPredicate
  | OwnerPredicate
  | IdFieldPredicate
  | TargetKindPredicate
  | TargetSchemaPredicate
  | TargetNamePredicate
  | EdgeToPredicate;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A filter rule: if the predicate matches, the delta is either excluded or
 * included (first-match-wins; no rule matches → include).
 */
export interface FilterRule {
  match: Predicate;
  action: "exclude" | "include";
}

/**
 * A serialize rule: if the predicate matches, the given params are contributed
 * to the effective PlanParams (first-matching rule wins per param key).
 */
export interface SerializeRule {
  match: Predicate;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface Policy {
  id: string;
  filter?: FilterRule[];
  serialize?: SerializeRule[];
  baseline?: string;
  extends?: Policy[];
}

// ---------------------------------------------------------------------------
// Glob helpers (no regex library; implement ourselves)
// ---------------------------------------------------------------------------

/** Escape all regex meta-characters except `*`, then replace `*` with `.*`. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexSource}$`);
}

function globMatch(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

// ---------------------------------------------------------------------------
// Identity field extraction helpers
// ---------------------------------------------------------------------------

function getSchema(id: StableId): string | undefined {
  if ("schema" in id && typeof id.schema === "string") return id.schema;
  return undefined;
}

function getName(id: StableId): string | undefined {
  if ("name" in id && typeof id.name === "string") return id.name;
  return undefined;
}

// ---------------------------------------------------------------------------
// Parent chain traversal (for ownedByExtension, parentKind)
// ---------------------------------------------------------------------------

/**
 * Walk the parent chain of a fact id upward in `fb`.
 * Returns all facts in the chain including the fact itself.
 */
function parentChain(id: StableId, fb: FactBase): Fact[] {
  const chain: Fact[] = [];
  let current: StableId | undefined = id;
  while (current !== undefined) {
    const fact = fb.get(current);
    if (!fact) break;
    chain.push(fact);
    current = fact.parent;
  }
  return chain;
}

/**
 * Check if any fact in the parent chain (inclusive) has an outgoing
 * "memberOfExtension" edge to an extension with the given name.
 */
function isOwnedByExtension(
  id: StableId,
  extensionName: string,
  fb: FactBase,
): boolean {
  const chain = parentChain(id, fb);
  for (const fact of chain) {
    const outgoing = fb.outgoingEdges(fact.id);
    for (const edge of outgoing) {
      if (
        edge.kind === "memberOfExtension" &&
        edge.to.kind === "extension" &&
        (edge.to as { kind: "extension"; name: string }).name === extensionName
      ) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core predicate evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a predicate against a Fact in a FactBase.
 *
 * For satellite (child) facts, `ownedByExtension` walks the parent chain so
 * that objects belonging to extension-owned parents are also covered.
 */
export function factMatches(
  predicate: Predicate,
  fact: Fact,
  view: FactBase,
): boolean {
  // Combinators
  if ("all" in predicate) {
    return predicate.all.every((p) => factMatches(p, fact, view));
  }
  if ("any" in predicate) {
    return predicate.any.some((p) => factMatches(p, fact, view));
  }
  if ("not" in predicate) {
    return !factMatches(predicate.not, fact, view);
  }

  // kind
  if ("kind" in predicate) {
    const kinds = Array.isArray(predicate.kind)
      ? predicate.kind
      : [predicate.kind];
    return kinds.some((k) => fact.id.kind === k);
  }

  // schema
  if ("schema" in predicate) {
    const schema = getSchema(fact.id);
    if (schema === undefined) return false;
    const patterns = Array.isArray(predicate.schema)
      ? predicate.schema
      : [predicate.schema];
    return patterns.some((p) => globMatch(p, schema));
  }

  // name
  if ("name" in predicate) {
    const name = getName(fact.id);
    if (name === undefined) return false;
    const patterns = Array.isArray(predicate.name)
      ? predicate.name
      : [predicate.name];
    return patterns.some((p) => globMatch(p, name));
  }

  // verb — not applicable to bare fact matching; treat as no-match
  if ("verb" in predicate) {
    return false;
  }

  // ownedByExtension
  if ("ownedByExtension" in predicate) {
    return isOwnedByExtension(fact.id, predicate.ownedByExtension, view);
  }

  // parentKind
  if ("parentKind" in predicate) {
    if (fact.parent === undefined) return false;
    return fact.parent.kind === predicate.parentKind;
  }

  // owner — matches when fact.payload["owner"] matches any glob
  if ("owner" in predicate) {
    const ownerVal = fact.payload["owner"];
    if (typeof ownerVal !== "string") return false;
    const patterns = Array.isArray(predicate.owner)
      ? predicate.owner
      : [predicate.owner];
    return patterns.some((p) => globMatch(p, ownerVal));
  }

  // idField — reads (fact.id as Record)[field], matches any glob
  if ("idField" in predicate) {
    const rawId = fact.id as Record<string, unknown>;
    const fieldVal = rawId[predicate.idField.field];
    if (typeof fieldVal !== "string") return false;
    const globs = Array.isArray(predicate.idField.glob)
      ? predicate.idField.glob
      : [predicate.idField.glob];
    return globs.some((g) => globMatch(g, fieldVal));
  }

  // targetKind — for satellite facts whose id has a target: StableId
  if ("targetKind" in predicate) {
    const rawId = fact.id as Record<string, unknown>;
    const target = rawId["target"];
    if (target === null || typeof target !== "object") return false;
    const targetKindVal = (target as Record<string, unknown>)["kind"];
    if (typeof targetKindVal !== "string") return false;
    const kinds = Array.isArray(predicate.targetKind)
      ? predicate.targetKind
      : [predicate.targetKind];
    return kinds.some((k) => k === targetKindVal);
  }

  // targetSchema — for satellite facts whose id has a target: StableId with schema
  if ("targetSchema" in predicate) {
    const rawId = fact.id as Record<string, unknown>;
    const target = rawId["target"];
    if (target === null || typeof target !== "object") return false;
    const targetSchemaVal = (target as Record<string, unknown>)["schema"];
    if (typeof targetSchemaVal !== "string") return false;
    const patterns = Array.isArray(predicate.targetSchema)
      ? predicate.targetSchema
      : [predicate.targetSchema];
    return patterns.some((p) => globMatch(p, targetSchemaVal));
  }

  // targetName — for satellite facts whose id has a target: StableId with name
  // (covers schema-kind targets which have `name` not `schema`)
  if ("targetName" in predicate) {
    const rawId = fact.id as Record<string, unknown>;
    const target = rawId["target"];
    if (target === null || typeof target !== "object") return false;
    const targetNameVal = (target as Record<string, unknown>)["name"];
    if (typeof targetNameVal !== "string") return false;
    const patterns = Array.isArray(predicate.targetName)
      ? predicate.targetName
      : [predicate.targetName];
    return patterns.some((p) => globMatch(p, targetNameVal));
  }

  // edgeTo — matches when outgoing edges contain one to kind/schema
  if ("edgeTo" in predicate) {
    const outgoing = view.outgoingEdges(fact.id);
    for (const edge of outgoing) {
      const toId = edge.to as Record<string, unknown>;
      if (
        predicate.edgeTo.kind !== undefined &&
        toId["kind"] !== predicate.edgeTo.kind
      ) {
        continue;
      }
      if (predicate.edgeTo.schema !== undefined) {
        const toSchema = toId["schema"];
        if (typeof toSchema !== "string") continue;
        const schemaPatterns = Array.isArray(predicate.edgeTo.schema)
          ? predicate.edgeTo.schema
          : [predicate.edgeTo.schema];
        if (!schemaPatterns.some((p) => globMatch(p, toSchema))) continue;
      }
      return true;
    }
    return false;
  }

  // exhaustive — TypeScript narrows to never here in strict mode
  const _exhaustive: never = predicate;
  return _exhaustive;
}

/**
 * Resolve the "subject fact" for a delta:
 *   add    → delta.fact in desired
 *   remove → delta.fact in source
 *   set    → desired.get(delta.id)
 *   link / unlink → the edge's `from` fact, resolved from the appropriate base
 *
 * Returns undefined when the fact cannot be resolved (dangling).
 */
function subjectFact(
  delta: Delta,
  source: FactBase,
  desired: FactBase,
): { fact: Fact; view: FactBase } | undefined {
  switch (delta.verb) {
    case "add": {
      const f = desired.get(delta.fact.id) ?? delta.fact;
      return { fact: f, view: desired };
    }
    case "remove": {
      const f = source.get(delta.fact.id) ?? delta.fact;
      return { fact: f, view: source };
    }
    case "set": {
      const f = desired.get(delta.id);
      if (!f) return undefined;
      return { fact: f, view: desired };
    }
    case "link": {
      const f = desired.get(delta.edge.from) ?? source.get(delta.edge.from);
      if (!f) return undefined;
      return { fact: f, view: desired };
    }
    case "unlink": {
      const f = source.get(delta.edge.from) ?? desired.get(delta.edge.from);
      if (!f) return undefined;
      return { fact: f, view: source };
    }
  }
}

/**
 * Evaluate a predicate against a Delta, using both source and desired bases.
 *
 * The "verb" predicate tests delta.verb; all other predicates test the
 * subject fact (resolved per the convention above).
 */
export function deltaMatches(
  predicate: Predicate,
  delta: Delta,
  source: FactBase,
  desired: FactBase,
): boolean {
  // Combinators — recurse before resolving subject
  if ("all" in predicate) {
    return predicate.all.every((p) => deltaMatches(p, delta, source, desired));
  }
  if ("any" in predicate) {
    return predicate.any.some((p) => deltaMatches(p, delta, source, desired));
  }
  if ("not" in predicate) {
    return !deltaMatches(predicate.not, delta, source, desired);
  }

  // verb predicate matches directly on delta.verb
  if ("verb" in predicate) {
    const verbs = Array.isArray(predicate.verb)
      ? predicate.verb
      : [predicate.verb];
    return verbs.some((v) => v === delta.verb);
  }

  // All other predicates delegate to factMatches on the subject fact
  const subject = subjectFact(delta, source, desired);
  if (subject === undefined) return false;
  return factMatches(predicate, subject.fact, subject.view);
}

// ---------------------------------------------------------------------------
// Policy flattening + validation
// ---------------------------------------------------------------------------

/**
 * Flatten a policy with cycle detection.
 * Own rules appear before parent rules (own-before-extends order).
 */
export function flattenPolicy(policy: Policy): {
  id: string;
  filter: FilterRule[];
  serialize: SerializeRule[];
  baseline?: string;
} {
  const visited = new Set<string>();
  return flattenInner(policy, visited);
}

function flattenInner(
  policy: Policy,
  visited: Set<string>,
): {
  id: string;
  filter: FilterRule[];
  serialize: SerializeRule[];
  baseline?: string;
} {
  if (visited.has(policy.id)) {
    throw new Error(
      `Policy cycle detected: policy "${policy.id}" extends itself (cycle)`,
    );
  }
  visited.add(policy.id);

  const ownFilter: FilterRule[] = policy.filter ?? [];
  const ownSerialize: SerializeRule[] = policy.serialize ?? [];
  const parentFilter: FilterRule[] = [];
  const parentSerialize: SerializeRule[] = [];

  if (policy.extends) {
    for (const parent of policy.extends) {
      // Each parent needs its own visited-set branch to allow diamond
      // inheritance between siblings while still catching cycles through
      // recursive extends chains.
      const branch = new Set(visited);
      const flat = flattenInner(parent, branch);
      parentFilter.push(...flat.filter);
      parentSerialize.push(...flat.serialize);
    }
  }

  visited.delete(policy.id);

  const result: {
    id: string;
    filter: FilterRule[];
    serialize: SerializeRule[];
    baseline?: string;
  } = {
    id: policy.id,
    filter: [...ownFilter, ...parentFilter],
    serialize: [...ownSerialize, ...parentSerialize],
  };
  if (policy.baseline !== undefined) {
    result.baseline = policy.baseline;
  }
  return result;
}

/**
 * Validate a policy: throws on unknown serialize param names and extends
 * cycles.
 */
export function validatePolicy(policy: Policy): void {
  // Cycle detection via flatten (throws on cycles)
  const flat = flattenPolicy(policy);

  // Validate serialize param names
  for (const rule of flat.serialize) {
    for (const paramName of Object.keys(rule.params)) {
      if (!KNOWN_PARAMS.has(paramName)) {
        throw new Error(
          `Policy "${policy.id}": unknown serialize parameter "${paramName}". ` +
            `Known parameters: ${[...KNOWN_PARAMS].join(", ")}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Filter application
// ---------------------------------------------------------------------------

/**
 * Apply policy filter rules (first-match-wins) to a list of deltas.
 *
 * No rule matches → include. Filtered (excluded) deltas are returned in
 * `filtered` — never silently dropped. "Drift the user chose not to manage
 * is still drift they can ask about." (§3.9)
 */
export function filterDeltas(
  deltas: Delta[],
  policy: Policy,
  source: FactBase,
  desired: FactBase,
): { kept: Delta[]; filtered: Delta[] } {
  const flat = flattenPolicy(policy);
  const kept: Delta[] = [];
  const filtered: Delta[] = [];

  for (const delta of deltas) {
    let matched = false;
    let action: "exclude" | "include" = "include";
    for (const rule of flat.filter) {
      if (deltaMatches(rule.match, delta, source, desired)) {
        matched = true;
        action = rule.action;
        break;
      }
    }
    if (!matched || action === "include") {
      kept.push(delta);
    } else {
      filtered.push(delta);
    }
  }

  return { kept, filtered };
}

// ---------------------------------------------------------------------------
// Serialize params merging
// ---------------------------------------------------------------------------

/**
 * Merge serialize params from all matching rules in policy evaluation order.
 *
 * Rules are evaluated in own-before-extends order (flattenPolicy). The first
 * matching rule to set a param key wins (later rules do not override earlier
 * ones). The common case — a match-everything rule `{ all: [] }` — is handled
 * naturally.
 *
 * This overload operates without a specific delta context; callers needing
 * per-delta params should use filterDeltas + their own rule evaluation.
 */
export function serializeParams(policy: Policy): PlanParams {
  const flat = flattenPolicy(policy);
  const result: PlanParams = {};

  for (const rule of flat.serialize) {
    for (const [key, value] of Object.entries(rule.params)) {
      if (!(key in result)) {
        result[key] = value;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { DependencyEdge, Fact, FactBase };
export type { Delta };
export type { FactKind, StableId };
export type { PlanParams };
