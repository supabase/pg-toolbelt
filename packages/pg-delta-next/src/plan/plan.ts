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
  resolveView,
  validatePolicy,
  type Policy,
} from "../policy/policy.ts";
import { canSetOwner, type ApplierCapability } from "../policy/capability.ts";
import { topoSort } from "./graph.ts";
import {
  actionTieKey,
  buildActionGraph,
  compactColumnFolds,
  computeSafetyReport,
} from "./internal.ts";
import { projectTarget } from "./project.ts";
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
  type KindRules,
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
  /** the applier capability the plan was produced with (move 6 / follow-up 2),
   *  inlined so a later prove/apply recovers the SAME view. `memberOf` is an
   *  array → the artifact round-trips losslessly. */
  capability?: ApplierCapability;
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
  /** applier capability (move 6): operations the applier cannot execute (e.g.
   *  FDW ACLs for a non-superuser) are projected out of the view. Probe with
   *  probeApplierCapability(pool). Default unrestricted. */
  capability?: ApplierCapability;
}

// Per-kind graph/suppression policy is DECLARED IN THE RULE TABLE
// (guardrail 3). These accessors read those flags; the planner body holds
// no kind-name lists. `rulesFor` throws for unknown kinds, so guard it.
function ruleFlag<K extends keyof KindRules>(
  kind: string,
  flag: K,
): KindRules[K] | undefined {
  try {
    return rulesFor(kind)[flag];
  } catch {
    return undefined;
  }
}
const cascadesToChildren = (kind: string): boolean =>
  ruleFlag(kind, "cascadesToChildren") === true;
const isRebuildable = (kind: string): boolean =>
  ruleFlag(kind, "rebuildable") === true;

export function plan(
  source: FactBase,
  desired: FactBase,
  options?: PlanOptions,
): Plan {
  if (options?.policy) validatePolicy(options.policy);
  // the managed VIEW the engine diffs (docs/managed-view-architecture.md): the
  // policy's scope (non-`verb`) rules + extension-member provenance are
  // projected out at the FACT level on BOTH sides, so the proof stays honest by
  // construction. `verb` rules remain for the delta-level filter below. With no
  // policy this is exactly `excludeExtensionMembers`, so the corpus is unchanged.
  source = resolveView(source, options?.policy, options?.capability);
  desired = resolveView(desired, options?.policy, options?.capability);
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
  // the honest plan target: `desired` with every FILTERED delta reverted to
  // its source value, since the plan only applies KEPT deltas (review #2). The
  // fingerprint and the proof both target THIS, not full `desired`.
  const projectedDesired = projectTarget(desired, filteredDeltas);

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
  // alters that invalidate dependents (e.g. an enum value-set replacement,
  // or an ALTER COLUMN TYPE that views/policies reference) seed the forced-
  // rebuild pass without replacing the fact itself. The value is the set of
  // dependent kinds to rebuild (null = all rebuildable kinds).
  const rebuildSeeds = new Map<string, ReadonlySet<string> | null>();
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
      if (attrRule === "replace") {
        replaceIds.add(key);
        continue;
      }
      const rebuild = attrRule.rebuildsDependents?.(s.from, s.to);
      if (rebuild === true) rebuildSeeds.set(key, null);
      else if (Array.isArray(rebuild)) rebuildSeeds.set(key, new Set(rebuild));
    }
  }

  // ── forced dependent rebuild (the clean expand-replace, §3.4) ─────────
  // A surviving dependent of something this plan destroys must be dropped
  // and recreated from the desired state — recursively. Which kinds are
  // rebuildable is declared per-kind in the rule table (`rebuildable`).
  {
    // `fullDestroy` ids rebuild EVERY rebuildable dependent; `rebuildSeeds`
    // (an in-place alter that invalidates only some dependent kinds) rebuild
    // only their declared kinds. Once a dependent is rebuilt it joins
    // `fullDestroy`, so its own subtree rebuilds completely.
    const fullDestroy = new Set([...removed.keys(), ...replaceIds]);
    const targets = new Set([...fullDestroy, ...rebuildSeeds.keys()]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of source.edges) {
        const toKey = encodeId(edge.to);
        if (!targets.has(toKey)) continue;
        const fromKey = encodeId(edge.from);
        if (targets.has(fromKey)) continue;
        const dependent = source.get(edge.from);
        if (!dependent || !desired.has(edge.from)) continue;
        if (!isRebuildable(dependent.id.kind)) continue;
        // reached only via a kind-restricted seed: honor the allowed kinds
        if (!fullDestroy.has(toKey)) {
          const allowed = rebuildSeeds.get(toKey);
          if (allowed && !allowed.has(dependent.id.kind)) continue;
        }
        replaceIds.add(fromKey);
        fullDestroy.add(fromKey);
        targets.add(fromKey);
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
  const isRemovedId = (id: StableId): boolean => {
    const key = encodeId(id);
    return removed.has(key) || replaceIds.has(key);
  };
  const dropRootOf = new Map<string, string>();
  const findDropRoot = (fact: Fact): string => {
    const key = encodeId(fact.id);
    const cached = dropRootOf.get(key);
    if (cached) return cached;
    let root = key;
    const rules = rulesFor(fact.id.kind);
    const suppressible = rules.suppressible?.(fact) ?? true;
    const parent = fact.parent;
    if (parent !== undefined && suppressible) {
      const parentRemoved = isRemovedId(parent);
      // a metadata satellite folds into ANY removed parent; otherwise the
      // parent kind must be one whose DROP cascades to children
      const cascades =
        rules.metadata === true || cascadesToChildren(parent.kind);
      if (parentRemoved && cascades) {
        root = findDropRoot(
          removed.get(encodeId(parent)) ?? (source.get(parent) as Fact),
        );
      }
    }
    dropRootOf.set(key, root);
    return root;
  };
  for (const fact of removed.values()) findDropRoot(fact);

  // a fact whose drop folds into a NON-parent ancestor (an OWNED BY
  // sequence into its owning column/table) — declared per-kind via
  // dropRootRedirect, resolved here
  for (const fact of removed.values()) {
    const redirect = rulesFor(fact.id.kind).dropRootRedirect?.(
      fact,
      isRemovedId,
    );
    if (redirect === undefined) continue;
    const redirectKey = encodeId(redirect);
    dropRootOf.set(
      encodeId(fact.id),
      dropRootOf.get(redirectKey) ?? redirectKey,
    );
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
  for (const fact of added.values()) {
    // which pg_default_acl objtype this kind maps to is declared per-kind
    // in the rule table (`defaclObjtype`); absent → no default ACLs
    const objtype = ruleFlag(fact.id.kind, "defaclObjtype");
    if (objtype === undefined) continue;
    // owner is now an edge, not a payload field (move 2)
    const ownerEdge = desired
      .outgoingEdges(fact.id)
      .find((e) => e.kind === "owner");
    const owner =
      ownerEdge?.to.kind === "role"
        ? (ownerEdge.to as { kind: "role"; name: string }).name
        : undefined;
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

  // owner-edge changes: emit ALTER … OWNER TO from link/unlink deltas
  // (move 2: owner is now an edge, not a payload attribute)
  {
    // collect old owner roles per fact so the link action can release them
    const oldOwnerByFact = new Map<string, StableId>();
    for (const delta of deltas) {
      if (delta.verb !== "unlink" || delta.edge.kind !== "owner") continue;
      oldOwnerByFact.set(encodeId(delta.edge.from), delta.edge.to);
    }
    for (const delta of deltas) {
      if (delta.verb !== "link" || delta.edge.kind !== "owner") continue;
      const objId = delta.edge.from;
      const objKey = encodeId(objId);
      // Created objects need this too: create no longer sets the owner (move 2),
      // so a fresh object owned by a non-applier role needs an explicit
      // ALTER … OWNER TO, ordered after its create (consumes: [objId]) and after
      // the role. An owner role projected out of the view has no edge here (it
      // was pruned), so the object is left applier-owned — skipAuthorization
      // elimination falls out for free.
      const fact = desired.get(objId);
      if (!fact) continue;
      const ownerAlterPrefix = ruleFlag(fact.id.kind, "ownerAlterPrefix");
      if (!ownerAlterPrefix) continue;
      const prefix = ownerAlterPrefix(fact);
      const newRoleId = delta.edge.to;
      if (newRoleId.kind !== "role") continue;
      const roleName = (newRoleId as { kind: "role"; name: string }).name;
      // Owner residue (move 6): `ALTER … OWNER TO R` requires the applier to be
      // a superuser or a member of R. If a capability is supplied and the
      // applier cannot, fail fast at plan time with an actionable message —
      // surfaced before any statement runs, and avoiding a non-converging
      // "leave it applier-owned" (the owner is acldefault-relative). Unset only
      // for owner CHANGES/creates (this is an owner link delta), not pre-existing
      // unchanged ownership.
      if (
        options?.capability !== undefined &&
        !canSetOwner(options.capability, roleName)
      ) {
        throw new Error(
          `capability: cannot set owner of ${encodeId(objId)} to role "${roleName}" — applier "${options.capability.role}" is not a superuser or a member of that role; grant membership or apply as a member/superuser`,
        );
      }
      const oldRoleId = oldOwnerByFact.get(objKey);
      pushAction(
        "alter",
        {
          sql: `${prefix} OWNER TO ${qid(roleName)}`,
          consumes: [newRoleId],
          ...(oldRoleId !== undefined ? { releases: [oldRoleId] } : {}),
        },
        { consumes: [objId] },
      );
    }
  }

  // ── graph edges + deterministic order ─────────────────────────────────
  // edge build + requirement checks and the tie-break key are extracted to
  // ./internal.ts (Item 7); they read only the emitted actions + the
  // producer/destroyer indexes + the two fact bases.
  const edges = buildActionGraph(
    actions,
    producerOf,
    destroyerOf,
    source,
    desired,
  );

  const order = topoSort(
    actions.length,
    edges,
    (i) => actionTieKey(actions, i),
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
  const finalActions =
    options?.compact !== false
      ? compactColumnFolds(
          orderedActions,
          order,
          edges,
          foldHints,
          acceptsFolds,
          positionOf,
        )
      : orderedActions;

  const safetyReport = computeSafetyReport(finalActions);

  return {
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: source.rootHash },
    target: { fingerprint: projectedDesired.rootHash },
    preamble: [{ name: "check_function_bodies", value: "off" }],
    deltas,
    filteredDeltas,
    ...(options?.policy ? { policy: options.policy } : {}),
    ...(options?.capability ? { capability: options.capability } : {}),
    renameCandidates,
    actions: finalActions,
    safetyReport,
  };
}
