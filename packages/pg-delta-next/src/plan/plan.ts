/**
 * The planner (target-architecture §3.4–3.6): deltas × rule table → atomic
 * actions → one mixed dependency graph → one deterministic sort.
 */
import { diff, type Delta } from "../core/diff.ts";
import type { Fact, FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import {
  factMatches,
  filterDeltas,
  flattenPolicy,
  validatePolicy,
  type Policy,
} from "../policy/policy.ts";
import { topoSort } from "./graph.ts";
import { lockClassFor, type LockClass } from "./locks.ts";
import { grantTarget, qid } from "./render.ts";
import {
  matchRenameCandidates,
  subtreeIds,
  type RenameCandidate,
  type RenameMode,
} from "./renames.ts";
import {
  KNOWN_PARAMS,
  rulesFor,
  type ActionSpec,
  type PlanParams,
} from "./rules.ts";

/** Engine version stamped into plan artifacts; apply refuses artifacts
 *  from an engine it does not understand (stage 6 deliverable 1). */
export const ENGINE_VERSION = "0.1.0";

export interface Action {
  sql: string;
  verb: "create" | "alter" | "drop";
  produces: StableId[];
  consumes: StableId[];
  destroys: StableId[];
  /** ids this action stops referencing — must run before their destroyer */
  releases: StableId[];
  /** three-valued transactionality (§3.8) */
  transactionality:
    | "transactional"
    | "nonTransactional"
    | "commitBoundaryAfter";
  /** documented lock level of this DDL form — reported, never certified */
  lockClass: LockClass;
  /** executor must COMMIT the current segment before this action (placed
   *  between a commitBoundaryAfter action and its first consumer) */
  newSegmentBefore: boolean;
  dataLoss: "none" | "destructive";
  rewriteRisk: boolean;
}

/** Aggregated per-action safety metadata (§3.7). Lock classes and
 *  rewrite/data-loss counts; the proof loop turns dataLoss into a
 *  verified claim, lock classes stay reported. */
export interface SafetyReport {
  destructiveActions: number;
  rewriteRiskActions: number;
  nonTransactionalActions: number;
  lockClasses: Partial<Record<LockClass, number>>;
}

export interface Plan {
  formatVersion: 1;
  engineVersion: string;
  source: { fingerprint: string };
  target: { fingerprint: string };
  /** session settings the executor applies per transaction segment —
   *  explicit plan metadata, not loose SQL in the action list */
  preamble: { name: string; value: string }[];
  deltas: Delta[];
  /** deltas the policy filtered out — reported, never silently absent
   *  (§3.9): drift the user chose not to manage is still drift they can
   *  ask about */
  filteredDeltas: Delta[];
  /** the policy that shaped this plan, inlined for reproducibility */
  policy?: Policy;
  /** every rename candidate found, applied or not — "prompt" mode renders
   *  these as questions; near-misses explain why they degraded (§4.1) */
  renameCandidates: RenameCandidate[];
  actions: Action[];
  safetyReport: SafetyReport;
}

export interface PlanOptions {
  /** named serialize parameters consumed by rule templates; unknown
   *  names are a plan-time error (stage 8 wires policies here) */
  params?: PlanParams;
  /** policy (§3.9): filters which deltas this plan manages and supplies
   *  serialize parameters; baseline subtraction happens before plan() —
   *  see subtractBaseline */
  policy?: Policy;
  /** rename detection (§4.1, stage 9). "auto" applies unambiguous
   *  candidates; "prompt" reports candidates and applies only those in
   *  acceptRenames; "off" (default) preserves drop+create. */
  renames?: RenameMode;
  /** in "prompt" mode: the candidates the caller confirmed */
  acceptRenames?: Array<{ from: StableId; to: StableId }>;
  /** compaction (§3.6): fold column clauses into their CREATE TABLE when
   *  no graph edge crosses the merge. Cosmetic by contract — proof results
   *  never change (asserted by the compaction suite). Default: true. */
  compact?: boolean;
}

/** Metadata kinds vanish with their parent regardless of parent kind. */
const METADATA_KINDS = new Set(["comment", "acl"]);
/** Containers whose DROP cascades to children (schema/role do NOT cascade). */
const CASCADING_PARENTS = new Set([
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "column",
  "constraint",
  "index",
  "sequence",
  "procedure",
  "aggregate",
  "domain",
  "type",
  "trigger",
  "policy",
  "rule",
  "default",
]);

export function plan(
  source: FactBase,
  desired: FactBase,
  options?: PlanOptions,
): Plan {
  if (options?.policy) validatePolicy(options.policy);
  const params: PlanParams = options?.params ?? {};
  for (const name of Object.keys(params)) {
    if (!KNOWN_PARAMS.has(name)) {
      throw new Error(
        `plan: unknown serialize parameter '${name}' — the rule table declares ${[...KNOWN_PARAMS].join(", ")}`,
      );
    }
  }
  // policy serialize rules apply PER FACT (first matching rule's params,
  // §3.9) — explicit options.params override rule-supplied values
  const serializeRules = options?.policy
    ? flattenPolicy(options.policy).serialize
    : [];
  const allDeltas = diff(source, desired);
  const { kept: deltas, filtered: filteredDeltas } = options?.policy
    ? filterDeltas(allDeltas, options.policy, source, desired)
    : { kept: allDeltas, filtered: [] };

  const removed = new Map<string, Fact>();
  const added = new Map<string, Fact>();
  const setsByFact = new Map<string, Extract<Delta, { verb: "set" }>[]>();
  for (const delta of deltas) {
    if (delta.verb === "remove")
      removed.set(encodeId(delta.fact.id), delta.fact);
    if (delta.verb === "add") added.set(encodeId(delta.fact.id), delta.fact);
    if (delta.verb === "set") {
      const key = encodeId(delta.id);
      const list = setsByFact.get(key) ?? [];
      list.push(delta);
      setsByFact.set(key, list);
    }
  }

  // ── rename detection (§4.1, stage 9) ──────────────────────────────────
  // accepted renames cancel their remove/add subtrees BEFORE replace,
  // rebuild, and suppression see them; the rename action is emitted later
  const renameMode: RenameMode = options?.renames ?? "off";
  const renameCandidates: RenameCandidate[] = [];
  const acceptedRenames: Array<{ from: Fact; to: Fact }> = [];
  if (renameMode !== "off") {
    const candidates = matchRenameCandidates(removed, added, source, desired);
    renameCandidates.push(...candidates);
    const confirmed = new Set(
      (options?.acceptRenames ?? []).map(
        (r) => `${encodeId(r.from)}>${encodeId(r.to)}`,
      ),
    );
    for (const candidate of candidates) {
      if (candidate.status !== "unambiguous") continue;
      const key = `${encodeId(candidate.from)}>${encodeId(candidate.to)}`;
      if (renameMode === "prompt" && !confirmed.has(key)) continue;
      const fromFact = removed.get(encodeId(candidate.from)) as Fact;
      const toFact = added.get(encodeId(candidate.to)) as Fact;
      // structural equality covers the whole subtree: cancel every
      // descendant's remove/add — the rename carries them implicitly
      for (const id of subtreeIds(source, candidate.from))
        removed.delete(encodeId(id));
      for (const id of subtreeIds(desired, candidate.to))
        added.delete(encodeId(id));
      acceptedRenames.push({ from: fromFact, to: toFact });
    }
  }

  // ── classify set-deltas: in-place alter vs replace ────────────────────
  const replaceIds = new Set<string>();
  // alters that invalidate dependents (e.g. an enum value-set replacement)
  // seed the forced-rebuild pass without replacing the fact itself
  const rebuildSeeds = new Set<string>();
  for (const [key, sets] of setsByFact) {
    const kind = (desired.get(sets[0]!.id) as Fact).id.kind;
    const rules = rulesFor(kind);
    for (const s of sets) {
      const attrRule = rules.attributes[s.attr];
      if (attrRule === undefined) {
        throw new Error(
          `rule table: kind '${kind}' has no rule for attribute '${s.attr}' (${key}) — extend the rule vocabulary (guardrail 3)`,
        );
      }
      if (attrRule === "replace") replaceIds.add(key);
      else if (attrRule.rebuildsDependents?.(s.from, s.to))
        rebuildSeeds.add(key);
    }
  }

  // ── forced dependent rebuild (the clean expand-replace, §3.4) ─────────
  // A surviving dependent of something this plan destroys must be dropped
  // and recreated from the desired state — recursively.
  const REBUILDABLE = new Set([
    "view",
    "materializedView",
    "index",
    "policy",
    "trigger",
    "rule",
    "constraint",
    "default",
    "procedure",
  ]);
  {
    const destroyedIds = new Set([
      ...removed.keys(),
      ...replaceIds,
      ...rebuildSeeds,
    ]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of source.edges) {
        if (!destroyedIds.has(encodeId(edge.to))) continue;
        const fromKey = encodeId(edge.from);
        if (destroyedIds.has(fromKey)) continue;
        const dependent = source.get(edge.from);
        if (!dependent || !desired.has(edge.from)) continue;
        if (!REBUILDABLE.has(dependent.id.kind)) continue;
        replaceIds.add(fromKey);
        destroyedIds.add(fromKey);
        grew = true;
      }
    }
    // descendants of replaced facts are handled by the ancestor's subtree
    // recreate — keep only the topmost replaced facts
    // deleting the entry under iteration is safe for a JS Set
    for (const key of replaceIds) {
      const fact = source.facts().find((f) => encodeId(f.id) === key);
      let ancestor = fact?.parent;
      while (ancestor !== undefined) {
        if (replaceIds.has(encodeId(ancestor))) {
          replaceIds.delete(key);
          break;
        }
        ancestor = source.get(ancestor)?.parent;
      }
    }
  }

  // ── suppression: child removals that cascade with an ancestor's drop ──
  // dropRootOf(id) = nearest removed ancestor whose drop action will exist.
  // FK constraint drops are NEVER suppressed: explicit DROP CONSTRAINT
  // before the table drops makes mutual-FK teardown cycles unconstructible
  // (decomposition over repair, §3.5).
  const dropRootOf = new Map<string, string>();
  const findDropRoot = (fact: Fact): string => {
    const key = encodeId(fact.id);
    const cached = dropRootOf.get(key);
    if (cached) return cached;
    let root = key;
    const parent = fact.parent;
    const isFkConstraint =
      fact.id.kind === "constraint" && fact.payload["type"] === "f";
    if (parent !== undefined && !isFkConstraint) {
      const parentKey = encodeId(parent);
      const parentRemoved = removed.has(parentKey) || replaceIds.has(parentKey);
      const cascades =
        METADATA_KINDS.has(fact.id.kind) || CASCADING_PARENTS.has(parent.kind);
      if (parentRemoved && cascades) {
        root = findDropRoot(
          removed.get(parentKey) ?? (source.get(parent) as Fact),
        );
      }
    }
    dropRootOf.set(key, root);
    return root;
  };
  for (const fact of removed.values()) findDropRoot(fact);

  // an OWNED BY sequence cascades with its owning column/table drop
  for (const fact of removed.values()) {
    if (fact.id.kind !== "sequence") continue;
    const ownedBy = fact.payload["ownedBy"] as {
      schema: string;
      table: string;
      column: string;
    } | null;
    if (ownedBy == null) continue;
    const columnKey = encodeId({
      kind: "column",
      schema: ownedBy.schema,
      table: ownedBy.table,
      name: ownedBy.column,
    });
    const tableKey = encodeId({
      kind: "table",
      schema: ownedBy.schema,
      name: ownedBy.table,
    });
    const ownerKey = removed.has(columnKey)
      ? columnKey
      : removed.has(tableKey)
        ? tableKey
        : null;
    if (ownerKey !== null) {
      dropRootOf.set(encodeId(fact.id), dropRootOf.get(ownerKey) ?? ownerKey);
    }
  }

  // ── emit actions ──────────────────────────────────────────────────────
  const actions: Action[] = [];
  const producerOf = new Map<string, number>();
  const destroyerOf = new Map<string, number>();
  // transient per-action compaction metadata (never enters the artifact)
  const foldHints: Array<{ foldInto: StableId; clause: string } | undefined> =
    [];
  const acceptsFolds: boolean[] = [];

  const pushAction = (
    verb: Action["verb"],
    spec: ActionSpec,
    opts: {
      produces?: StableId[];
      consumes?: StableId[];
      destroys?: StableId[];
    },
  ): number => {
    const index = actions.length;
    const produces = [...(opts.produces ?? []), ...(spec.alsoProduces ?? [])];
    const destroys = [...(opts.destroys ?? []), ...(spec.alsoDestroys ?? [])];
    const consumes = [...(opts.consumes ?? []), ...(spec.consumes ?? [])];
    const subjectKind = (produces[0] ?? destroys[0] ?? consumes[0])?.kind;
    actions.push({
      sql: spec.sql,
      verb,
      produces,
      consumes,
      destroys,
      releases: spec.releases ?? [],
      transactionality: spec.transactionality ?? "transactional",
      lockClass:
        spec.lockClass ??
        (subjectKind === undefined ? "none" : lockClassFor(subjectKind, verb)),
      newSegmentBefore: false,
      dataLoss: spec.dataLoss ?? "none",
      rewriteRisk: spec.rewriteRisk ?? false,
    });
    foldHints[index] = spec.compaction;
    acceptsFolds[index] = spec.acceptsColumnFolds ?? false;
    for (const id of produces) {
      const key = encodeId(id);
      if (!producerOf.has(key)) producerOf.set(key, index);
    }
    for (const id of destroys) destroyerOf.set(encodeId(id), index);
    return index;
  };

  const paramsCache = new Map<string, PlanParams>();
  const paramsFor = (fact: Fact): PlanParams => {
    if (serializeRules.length === 0) return params;
    const key = encodeId(fact.id);
    const cached = paramsCache.get(key);
    if (cached !== undefined) return cached;
    let merged = params;
    for (const rule of serializeRules) {
      if (factMatches(rule.match, fact, desired)) {
        merged = { ...rule.params, ...params };
        break;
      }
    }
    paramsCache.set(key, merged);
    return merged;
  };

  const emitCreate = (fact: Fact, base: FactBase): void => {
    const specs = rulesFor(fact.id.kind).create(fact, base, paramsFor(fact));
    specs.forEach((spec, i) => {
      pushAction("create", spec, {
        produces: i === 0 ? [fact.id] : [],
        consumes: [
          ...(i === 0 ? [] : [fact.id]),
          ...(fact.parent !== undefined ? [fact.parent] : []),
        ],
      });
    });
  };

  // renames: one action renames the whole subtree — produces every new
  // id, destroys every old id; dependents order against those sets
  for (const { from, to } of acceptedRenames) {
    const rename = rulesFor(from.id.kind).rename;
    if (rename === undefined) {
      throw new Error(
        `rename: kind '${from.id.kind}' matched as candidate but has no rename rule`,
      );
    }
    pushAction("alter", rename(from, to.id), {
      produces: subtreeIds(desired, to.id),
      destroys: subtreeIds(source, from.id),
      consumes: to.parent !== undefined ? [to.parent] : [],
    });
  }

  // creates — parents first, so a parent's delta-set inlining (e.g. a
  // partitioned table's columns rendered inside its CREATE, registered via
  // alsoProduces) is visible before its children are considered
  const depthOf = (fact: Fact): number => {
    let depth = 0;
    let parent = fact.parent;
    while (parent !== undefined) {
      depth++;
      parent = desired.get(parent)?.parent;
    }
    return depth;
  };
  for (const fact of [...added.values()].sort(
    (a, b) => depthOf(a) - depthOf(b),
  )) {
    if (producerOf.has(encodeId(fact.id))) continue;
    emitCreate(fact, desired);
  }

  // default-privilege hygiene: objects created under active default ACLs
  // receive implicit grants; revoke them when the desired state has no
  // corresponding acl fact (pg_dump-style clean slate)
  const DEFACL_KIND: Record<string, string> = {
    table: "r",
    view: "r",
    materializedView: "r",
    foreignTable: "r",
    sequence: "S",
    procedure: "f",
    aggregate: "f",
  };
  for (const fact of added.values()) {
    const objtype = DEFACL_KIND[fact.id.kind];
    if (objtype === undefined) continue;
    const owner = fact.payload["owner"];
    if (typeof owner !== "string") continue;
    const schema = (fact.id as { schema?: string }).schema ?? null;
    for (const dp of desired.facts()) {
      if (dp.id.kind !== "defaultPrivilege") continue;
      const dpid = dp.id as {
        role: string;
        schema: string | null;
        objtype: string;
        grantee: string;
      };
      if (dpid.role !== owner || dpid.objtype !== objtype) continue;
      if (dpid.schema != null && dpid.schema !== schema) continue;
      if (dpid.grantee === owner) continue; // the owner's implicit entry IS the default
      const aclId: StableId = {
        kind: "acl",
        target: fact.id,
        grantee: dpid.grantee,
      };
      if (desired.has(aclId)) continue; // acl create's REVOKE-first handles it
      pushAction(
        "alter",
        {
          sql: `REVOKE ALL ON ${grantTarget(fact.id)} FROM ${dpid.grantee === "PUBLIC" ? "PUBLIC" : qid(dpid.grantee)}`,
          consumes:
            dpid.grantee === "PUBLIC"
              ? []
              : [{ kind: "role", name: dpid.grantee } as StableId],
        },
        { consumes: [fact.id] },
      );
    }
  }

  // drops (suppressed children fold into their root's destroys)
  const destroysByRoot = new Map<string, StableId[]>();
  for (const [key, fact] of removed) {
    const root = dropRootOf.get(key) as string;
    const list = destroysByRoot.get(root) ?? [];
    list.push(fact.id);
    destroysByRoot.set(root, list);
  }
  for (const [key, fact] of removed) {
    if (dropRootOf.get(key) !== key) continue; // suppressed
    if (replaceIds.has(key)) continue; // replace handles its own drop
    const spec = rulesFor(fact.id.kind).drop(fact);
    const destroyList = destroysByRoot.get(key) ?? [fact.id];
    pushAction("drop", spec, {
      consumes: fact.parent !== undefined ? [fact.parent] : [],
      // the root fact leads: it is the action's subject (tie-break, locks)
      destroys: [fact.id, ...destroyList.filter((id) => encodeId(id) !== key)],
    });
  }

  // replaces: drop old + create new (+ recreate unchanged descendants)
  const recreatedByReplace = new Set<string>();
  for (const key of replaceIds) {
    const oldFact = source.facts().find((f) => encodeId(f.id) === key) as Fact;
    const newFact = desired.facts().find((f) => encodeId(f.id) === key) as Fact;
    // old descendants die with the drop
    const oldDescendants: StableId[] = [oldFact.id];
    const walkOld = (id: StableId): void => {
      for (const child of source.childrenOf(id)) {
        oldDescendants.push(child.id);
        walkOld(child.id);
      }
    };
    walkOld(oldFact.id);
    const dropSpec = rulesFor(oldFact.id.kind).drop(oldFact);
    pushAction("drop", dropSpec, {
      consumes: oldFact.parent !== undefined ? [oldFact.parent] : [],
      destroys: oldDescendants,
    });
    emitCreate(newFact, desired);
    // recreate surviving descendants from the DESIRED state (satellites,
    // sub-facts). Descendants with their own attribute deltas are covered:
    // the create renders the desired payload, so their alters are skipped.
    const recreate = (id: StableId): void => {
      for (const child of desired.childrenOf(id)) {
        const childKey = encodeId(child.id);
        if (added.has(childKey)) continue; // already created via add delta
        recreatedByReplace.add(childKey);
        emitCreate(child, desired);
        recreate(child.id);
      }
    };
    recreate(newFact.id);
  }

  // in-place alters (skipped for facts a replace already recreated)
  for (const [key, sets] of setsByFact) {
    if (replaceIds.has(key) || recreatedByReplace.has(key)) continue;
    const fact = desired.get(sets[0]!.id) as Fact;
    const rules = rulesFor(fact.id.kind);
    for (const s of sets) {
      const attrRule = rules.attributes[s.attr];
      if (attrRule === undefined || attrRule === "replace") continue;
      const specs = attrRule.alter(fact, s.from, s.to, desired, source);
      for (const spec of Array.isArray(specs) ? specs : [specs]) {
        pushAction("alter", spec, { consumes: [fact.id] });
      }
    }
  }

  // ── graph edges ───────────────────────────────────────────────────────
  const edges: Array<[number, number]> = [];

  // cache encoded -> StableId for ids we encounter
  const parseKeyCache = new Map<string, StableId>();
  const remember = (id: StableId): string => {
    const key = encodeId(id);
    parseKeyCache.set(key, id);
    return key;
  };

  // alter actions indexed by their primary fact (opts.consumes[0])
  const alterersOf = new Map<string, number[]>();
  actions.forEach((action, index) => {
    if (action.verb !== "alter") return;
    const primary = action.consumes[0];
    if (primary === undefined) return;
    const key = encodeId(primary);
    const list = alterersOf.get(key) ?? [];
    list.push(index);
    alterersOf.set(key, list);
  });

  actions.forEach((action, index) => {
    for (const id of action.releases) {
      const destroyer = destroyerOf.get(remember(id));
      if (destroyer !== undefined && destroyer !== index) {
        edges.push([index, destroyer]);
      }
    }
    for (const id of action.consumes) {
      const key = remember(id);
      const producer = producerOf.get(key);
      if (producer !== undefined && producer !== index)
        edges.push([producer, index]);
      const destroyer = destroyerOf.get(key);
      // consumer-before-destroyer applies only when the id is NOT being
      // re-produced; consumers of a replaced fact use the new one
      if (
        destroyer !== undefined &&
        destroyer !== index &&
        producer === undefined
      ) {
        edges.push([index, destroyer]);
      }
      // the id must exist on the target before apply (source) or be
      // produced by this plan; "it's in the desired state" is not enough —
      // a policy filter can hide the delta that would have created it.
      // Built-in roles (pg_*) and PUBLIC are guaranteed by PostgreSQL
      // itself and never extracted as facts.
      const isBuiltinRole =
        id.kind === "role" &&
        ((id as { name: string }).name.startsWith("pg_") ||
          (id as { name: string }).name === "PUBLIC");
      if (producer === undefined && !source.has(id) && !isBuiltinRole) {
        throw new Error(
          `missing requirement: action "${action.sql}" consumes ${key}, which neither exists on the target nor is produced by this plan${desired.has(id) ? " — a filter may be hiding its creation" : ""}`,
        );
      }
    }
    // build order from the DESIRED state's dependency edges
    const producesKeys = new Set(action.produces.map((id) => encodeId(id)));
    for (const id of action.produces) {
      remember(id);
      if (!desired.has(id)) continue;
      for (const edge of desired.outgoingEdges(id)) {
        const targetKey = remember(edge.to);
        const producer = producerOf.get(targetKey);
        if (producer !== undefined && producer !== index) {
          edges.push([producer, index]);
        } else if (producer === undefined) {
          // the dependency is kept but altered in place: create the dependent
          // against its FINAL state (e.g. a view recreated after an enum's
          // value-set migration). Skip alterers that consume what this action
          // produces — there the alter needs the create first (REPLICA
          // IDENTITY USING a new index).
          for (const alterer of alterersOf.get(targetKey) ?? []) {
            if (alterer === index) continue;
            const altererConsumesProduct = (
              actions[alterer] as Action
            ).consumes.some((c) => producesKeys.has(encodeId(c)));
            if (!altererConsumesProduct) edges.push([alterer, index]);
          }
        }
      }
    }
    // teardown order from the SOURCE state's dependency edges
    const destroysKeys = new Set(action.destroys.map((id) => encodeId(id)));
    for (const id of action.destroys) {
      const key = remember(id);
      // replace: destroy before re-produce. This applies even to ids with no
      // source fact — DROP IDENTITY implicitly destroys the backing sequence
      // (alsoDestroys), which a CREATE SEQUENCE of the same name re-produces
      const reproducer = producerOf.get(key);
      if (reproducer !== undefined && reproducer !== index)
        edges.push([index, reproducer]);
      if (!source.has(id)) continue;
      for (const edge of source.edges) {
        if (encodeId(edge.to) !== key) continue;
        const dependentKey = remember(edge.from);
        const dependentDestroyer = destroyerOf.get(dependentKey);
        if (dependentDestroyer !== undefined && dependentDestroyer !== index) {
          edges.push([dependentDestroyer, index]);
        } else if (dependentDestroyer === undefined && desired.has(edge.from)) {
          if (producerOf.has(key)) continue;
          // the desired state no longer carries this dependency: whatever
          // alters the dependent (e.g. ALTER PUBLICATION … SET delisting a
          // dropped table) releases it — order those alters first
          const stillRequired = desired
            .outgoingEdges(edge.from)
            .some((e) => encodeId(e.to) === key);
          if (!stillRequired) {
            for (const alterer of alterersOf.get(dependentKey) ?? []) {
              if (alterer !== index) edges.push([alterer, index]);
            }
            continue;
          }
          // a surviving fact depends on something this plan destroys, and
          // nothing recreates the dependency: fail loudly (stage-5 deliverable 6)
          throw new Error(
            `missing requirement: ${dependentKey} survives but depends on ${key}, which this plan drops without recreating`,
          );
        }
      }
      // a dependent's teardown precedes in-place alters of its dependencies
      // (drop the view before migrating the enum its definition references);
      // an alterer that releases something this action destroys is the
      // opposite shape — releases ordering wins there
      for (const edge of source.outgoingEdges(id)) {
        const depKey = remember(edge.to);
        if (destroyerOf.has(depKey)) continue;
        for (const alterer of alterersOf.get(depKey) ?? []) {
          if (alterer === index) continue;
          const altererReleasesOurDestroy = (
            actions[alterer] as Action
          ).releases.some((r) => destroysKeys.has(encodeId(r)));
          if (!altererReleasesOurDestroy) edges.push([index, alterer]);
        }
      }
      // child teardown precedes parent teardown
      const fact = source.get(id);
      if (fact?.parent !== undefined) {
        const parentDestroyer = destroyerOf.get(remember(fact.parent));
        if (parentDestroyer !== undefined && parentDestroyer !== index) {
          edges.push([index, parentDestroyer]);
        }
      }
    }
  });

  // ── deterministic order ───────────────────────────────────────────────
  const tieKeyOf = (i: number): string => {
    const action = actions[i] as Action;
    const subject =
      action.produces[0] ?? action.destroys[0] ?? action.consumes[0];
    const kind = subject?.kind ?? "zz";
    const weight = (() => {
      try {
        return rulesFor(kind).weight;
      } catch {
        return 99;
      }
    })();
    const phase = action.verb === "drop" ? "0" : "1";
    const w = action.verb === "drop" ? 99 - weight : weight;
    // the index is zero-padded: this is a STRING key, and "10" < "9" would
    // scramble multi-spec sequences (the enum value-set migration relies on
    // emission order among equal-priority actions)
    return `${phase}|${String(w).padStart(2, "0")}|${subject ? encodeId(subject) : ""}|${String(i).padStart(6, "0")}`;
  };

  const order = topoSort(
    actions.length,
    edges,
    tieKeyOf,
    (i) => (actions[i] as Action).sql,
  );

  // ── segment boundaries for commitBoundaryAfter actions (§3.8) ─────────
  // a boundary goes before the FIRST graph successor of each such action;
  // all other successors are topologically later, so one commit suffices
  const positionOf = Array.from({ length: actions.length }, () => 0);
  order.forEach((actionIndex, position) => {
    positionOf[actionIndex] = position;
  });
  const orderedActions = order.map((i) => actions[i] as Action);
  for (let u = 0; u < actions.length; u++) {
    if ((actions[u] as Action).transactionality !== "commitBoundaryAfter")
      continue;
    let firstConsumerPos = Number.POSITIVE_INFINITY;
    for (const [a, b] of edges) {
      if (a !== u) continue;
      const pos = positionOf[b] as number;
      if (pos < firstConsumerPos) firstConsumerPos = pos;
    }
    if (Number.isFinite(firstConsumerPos)) {
      (orderedActions[firstConsumerPos] as Action).newSegmentBefore = true;
    }
  }

  // ── compaction (§3.6, stage 5 deliverable 4) ──────────────────────────
  // fold ADD COLUMN clauses into their bare CREATE TABLE. Safe iff every
  // graph predecessor of the folded action sits at or before the target —
  // i.e. no edge crosses the merge. Purely cosmetic: produces/consumes
  // merge, so ordering semantics and the proof are unchanged.
  let finalActions = orderedActions;
  if (options?.compact !== false) {
    const predecessorsOf = new Map<number, number[]>();
    for (const [a, b] of edges) {
      const list = predecessorsOf.get(b) ?? [];
      list.push(a);
      predecessorsOf.set(b, list);
    }
    const targetPosOf = new Map<string, number>();
    orderedActions.forEach((action, pos) => {
      for (const id of action.produces) {
        const key = encodeId(id);
        if (!targetPosOf.has(key)) targetPosOf.set(key, pos);
      }
    });
    const foldedPos = new Set<number>();
    const effectivePosOf = new Map<number, number>(); // orig idx -> post-fold pos
    for (let pos = 0; pos < orderedActions.length; pos++) {
      const origIndex = order[pos] as number;
      const hint = foldHints[origIndex];
      if (hint === undefined) continue;
      const action = orderedActions[pos] as Action;
      if (
        action.newSegmentBefore ||
        action.transactionality !== "transactional"
      )
        continue;
      const targetPos = targetPosOf.get(encodeId(hint.foldInto));
      if (targetPos === undefined || targetPos >= pos) continue;
      const targetOrig = order[targetPos] as number;
      if (!acceptsFolds[targetOrig] || foldedPos.has(targetPos)) continue;
      const target = orderedActions[targetPos] as Action;
      if (target.verb !== "create" || target.newSegmentBefore) continue;
      const crossesEdge = (predecessorsOf.get(origIndex) ?? []).some((p) => {
        const pPos = effectivePosOf.get(p) ?? (positionOf[p] as number);
        return pPos > targetPos;
      });
      if (crossesEdge) continue;
      // fold: splice the clause into the CREATE's column list
      target.sql = target.sql.endsWith("()")
        ? `${target.sql.slice(0, -2)}(${hint.clause})`
        : `${target.sql.slice(0, -1)}, ${hint.clause})`;
      target.produces.push(...action.produces);
      for (const id of action.consumes) {
        if (!target.consumes.some((c) => encodeId(c) === encodeId(id)))
          target.consumes.push(id);
      }
      if (action.dataLoss === "destructive") target.dataLoss = "destructive";
      target.rewriteRisk = target.rewriteRisk || action.rewriteRisk;
      foldedPos.add(pos);
      effectivePosOf.set(origIndex, targetPos);
    }
    if (foldedPos.size > 0) {
      finalActions = orderedActions.filter((_, pos) => !foldedPos.has(pos));
    }
  }

  const safetyReport: SafetyReport = {
    destructiveActions: finalActions.filter((a) => a.dataLoss === "destructive")
      .length,
    rewriteRiskActions: finalActions.filter((a) => a.rewriteRisk).length,
    nonTransactionalActions: finalActions.filter(
      (a) => a.transactionality === "nonTransactional",
    ).length,
    lockClasses: {},
  };
  for (const action of finalActions) {
    safetyReport.lockClasses[action.lockClass] =
      (safetyReport.lockClasses[action.lockClass] ?? 0) + 1;
  }

  return {
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: source.rootHash },
    target: { fingerprint: desired.rootHash },
    preamble: [{ name: "check_function_bodies", value: "off" }],
    deltas,
    filteredDeltas,
    ...(options?.policy ? { policy: options.policy } : {}),
    renameCandidates,
    actions: finalActions,
    safetyReport,
  };
}
