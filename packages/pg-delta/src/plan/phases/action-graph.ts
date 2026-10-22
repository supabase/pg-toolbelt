/**
 * Planner phase 4 — ActionGraph (target-architecture §3.5–3.6).
 *
 * Turns the emitted action list into a deterministically ordered, compacted
 * final list plus the aggregated safety report. Pure over its inputs (the
 * emitted actions + producer/destroyer indexes + the two fact bases); the graph
 * construction, topo sort, segment-boundary marking, and compaction building
 * blocks live in ../internal.ts. Extracted so the ordering/compaction stage is a
 * named phase boundary rather than a tail of `plan()`.
 */
import type { FactBase } from "../../core/fact.ts";
import type { Action, SafetyReport } from "../plan.ts";
import { topoSort } from "../graph.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type { ApplierCapability } from "../../policy/capability.ts";
import {
  isOverlayDefaultPrivilege,
  type AssumedDefaultGrant,
} from "../../policy/policy.ts";
import type { FoldHint, RulesForId } from "../rules.ts";
import {
  actionTieKey,
  buildActionGraph,
  compactColumnFolds,
  computeSafetyReport,
  elideCascadeSubsumedPolicyDrops,
  elideCoCreateRevokeBeforeGrant,
  elideDefaultAclCreates,
  elideRedundantDrops,
  foldCoCreateOwnership,
  mergeCoTargetGrants,
  mergeCoTargetRevokes,
} from "../internal.ts";

/** A column create's table and declared position (`_position`,
 *  pg_attribute.attnum), or undefined for any other action. */
function columnCreateSlot(
  action: Action,
  id: StableId | undefined,
  desired: FactBase,
): { tableKey: string; position: number } | undefined {
  if (action.verb !== "create" || id?.kind !== "column") return undefined;
  const position = desired.get(id)?.payload["_position"];
  if (typeof position !== "number") return undefined;
  return { tableKey: `${id.schema}\x00${id.table}`, position };
}

/**
 * `ADD COLUMN` always appends, so a table's new columns must be added in
 * declared order (`_position`, pg_attribute.attnum). The tie-break in
 * `actionTieKey` only orders the columns that are ready at the same time: a
 * column still waiting on a later dependency (a function its generated
 * expression calls, rule weight 8 > column 5) lets the ready columns after it
 * go first (#518). Chain each table's column creates by position so each one
 * waits for the one before it.
 *
 * Two kinds of column keep only the tie-break order, so they can land after
 * the columns declared behind them:
 *  - an evaluator column (`evaluatorActions`): its DEFAULT calls a user
 *    function, which Postgres runs at ADD COLUMN time even on an empty table.
 *    The function may read a later column with no pg_depend edge to it (a
 *    plpgsql or quoted SQL body), so only the evaluator stratum keeps the
 *    column after it. No chain edge starts from such a column; the next column
 *    chains from the last one before it instead. A generated column on a table
 *    this plan creates is exempt: Postgres computes it per row, and the new
 *    table has none.
 *  - a column whose chain edge would close a cycle with a real dependency (a
 *    generated column reading a column declared after it). That edge is
 *    skipped.
 *
 * Ordering edges change no SQL text, but a wrong edge can make the plan fail to
 * apply, so every edge here must be one Postgres can honor.
 */
function chainColumnCreatesByPosition(
  actions: readonly Action[],
  desired: FactBase,
  producerOf: ReadonlyMap<string, number>,
  evaluatorActions: ReadonlySet<number>,
  edges: Array<[number, number]>,
): void {
  const columnsByTable = new Map<
    string,
    Array<{ position: number; index: number }>
  >();
  actions.forEach((action, index) => {
    const slot = columnCreateSlot(action, action.produces[0], desired);
    if (slot === undefined) return;
    const columns = columnsByTable.get(slot.tableKey) ?? [];
    columns.push({ position: slot.position, index });
    columnsByTable.set(slot.tableKey, columns);
  });
  if (![...columnsByTable.values()].some((columns) => columns.length > 1)) {
    return;
  }

  const successorsOf = new Map<number, number[]>();
  const addSuccessor = (before: number, after: number): void => {
    const list = successorsOf.get(before) ?? [];
    list.push(after);
    successorsOf.set(before, list);
  };
  for (const [before, after] of edges) addSuccessor(before, after);
  // Walks forwards from `from` over its dependents. Columns are chained in
  // position order, so `from` has no outgoing chain edge yet and the walk
  // covers only its real downstream closure (constraints, indexes, views),
  // not the earlier columns of the chain.
  const reaches = (from: number, target: number): boolean => {
    const seen = new Set<number>([from]);
    const stack = [from];
    while (stack.length > 0) {
      for (const s of successorsOf.get(stack.pop() as number) ?? []) {
        if (s === target) return true;
        if (seen.has(s)) continue;
        seen.add(s);
        stack.push(s);
      }
    }
    return false;
  };
  // Whether a later column may wait on this one (see the doc comment).
  const canLead = (index: number): boolean => {
    if (!evaluatorActions.has(index)) return true;
    const id = (actions[index] as Action).produces[0] as StableId;
    const fact = desired.get(id);
    if (fact?.payload["generatedExpr"] == null || fact.parent === undefined) {
      return false;
    }
    const tableProducer = producerOf.get(encodeId(fact.parent));
    return (
      tableProducer !== undefined &&
      (actions[tableProducer] as Action).verb === "create"
    );
  };

  for (const columns of columnsByTable.values()) {
    columns.sort((a, b) => a.position - b.position);
    let before: number | undefined;
    for (const { index: after } of columns) {
      // `before → after` closes a cycle iff `after` already precedes `before`.
      if (before !== undefined && !reaches(after, before)) {
        edges.push([before, after]);
        addSuccessor(before, after);
      }
      if (canLead(after)) before = after;
    }
  }
}

export interface FinalizeInput {
  actions: Action[];
  producerOf: ReadonlyMap<string, number>;
  destroyerOf: ReadonlyMap<string, number>;
  /** resolved source / desired views (NOT the projected target): graph build
   *  order reads desired edges, teardown reads source edges. */
  source: FactBase;
  desired: FactBase;
  renameActionIndices: ReadonlySet<number>;
  /** action index → encoded `destroys` ids that are side-effect wipes (see
   *  ActionEmitterOutput.implicitDestroys). */
  implicitDestroys: ReadonlyMap<number, ReadonlySet<string>>;
  /** per-action compaction metadata captured during emission (never persisted). */
  foldHints: ReadonlyArray<FoldHint | undefined>;
  acceptsFolds: readonly boolean[];
  /** policy-declared roles assumed to exist at apply time (e.g. Supabase
   *  anon/authenticated) — exempt from the missing-requirement guard just like
   *  the `pg_` prefix and PUBLIC. Empty under the raw/no-policy path. */
  assumedRoleNames: ReadonlySet<string>;
  /** policy-declared schemas assumed to exist at apply time (e.g. Supabase's
   *  `extensions`) — exempt from the missing-requirement guard like the assumed
   *  roles. Empty under the raw/no-policy path. */
  assumedSchemaNames: ReadonlySet<string>;
  /** encoded ids of platform-provisioned members of assumed schemas (system-
   *  role-owned, e.g. `supabase_functions.http_request()`) — exempt from the
   *  missing-requirement guard even when kept reference-only on the desired
   *  side and absent from the target. Computed by plan() from the RAW fact
   *  bases; empty under the raw/no-policy path. */
  assumedPresentIds: ReadonlySet<string>;
  /** Overlay tuples — keep a co-create REVOKE when the holder is a strict
   *  subset of `_ownerDefault` (dest injectee may be a superset). Empty →
   *  today's elision. */
  assumedDefaultGrants: readonly AssumedDefaultGrant[];
  /** Export-only overlay wipe tuples (`options.assumedDefaultGrants`). Distinct
   *  from `assumedDefaultGrants` (policy ∪ options): schema-stratum weight
   *  applies only to wipe creates the emitter actually prepended. */
  overlayAdpWipes: readonly AssumedDefaultGrant[];
  /** applier capability (move 6) — needed by the co-create compaction passes:
   *  the owner-ALTER no-op elision and the REVOKE-before-GRANT superset guard key
   *  off `capability.role`. Undefined under the unrestricted (superuser/CI/raw)
   *  path, where those capability-gated elisions stay conservative. */
  capability: ApplierCapability | undefined;
  /** §3.6 compaction; cosmetic-by-contract (proof unchanged). Default true. */
  compact: boolean;
  /** Export-only constraint folding: apply the constraint rules' inline-fold
   *  hints (CONSTRAINT name <def> into the table's CREATE parens), excluding
   *  the given encoded constraint ids (cycle-participating FKs). Undefined
   *  (the default, and every non-export path) leaves those hints inert. */
  foldConstraints: { exclude?: ReadonlySet<string> } | undefined;
  /** id-keyed rule resolver (schema kinds + `extensionIntent`), used by the
   *  tie-break so intent actions sort on their declared late weight. */
  rulesForId: RulesForId;
}

export interface FinalizeOutput {
  actions: Action[];
  safetyReport: SafetyReport;
}

/**
 * Order, segment-mark, and compact the emitted actions; compute the safety
 * report. Behavior-preserving extraction of `plan()`'s graph/order/compaction
 * tail.
 */
export function finalizeActions(input: FinalizeInput): FinalizeOutput {
  const {
    actions,
    producerOf,
    destroyerOf,
    source,
    desired,
    renameActionIndices,
    implicitDestroys,
    foldHints,
    acceptsFolds,
    assumedRoleNames,
    assumedSchemaNames,
    assumedPresentIds,
    assumedDefaultGrants,
    overlayAdpWipes,
    capability,
    compact,
    foldConstraints,
    rulesForId,
  } = input;

  // ── graph edges + deterministic order ─────────────────────────────────
  // Actions that RUN a user expression at apply time (a DEFAULT / generated
  // column backfill, a validated CHECK scan, an expression-index build).
  // Classified during the edge walk and fed to the tie-break ONLY — never as an
  // edge — so they sink below every simultaneously ready DEFINITION action
  // without making legitimate routine<->relation cycles unplannable.
  const evaluatorActions = new Set<number>();
  const overlayWipeActions = new Set<number>();
  if (overlayAdpWipes.length > 0) {
    actions.forEach((action, i) => {
      if (action.verb !== "create") return;
      const id = action.produces[0];
      if (id !== undefined && isOverlayDefaultPrivilege(overlayAdpWipes, id)) {
        overlayWipeActions.add(i);
      }
    });
  }
  const edges = buildActionGraph(
    actions,
    producerOf,
    destroyerOf,
    source,
    desired,
    renameActionIndices,
    assumedRoleNames,
    assumedSchemaNames,
    assumedPresentIds,
    evaluatorActions,
    implicitDestroys,
  );
  chainColumnCreatesByPosition(
    actions,
    desired,
    producerOf,
    evaluatorActions,
    edges,
  );

  // Order a table's ADD COLUMN creates by declared column position
  // (pg_attribute.attnum, carried as the non-semantic `_position` field) instead
  // of column NAME, so a from-empty CREATE renders columns in declared order —
  // and the compaction pass, which folds them into the CREATE parens in this
  // order, inherits it. Only column CREATES are affected; drops/alters and every
  // other kind keep their encoded-id tie-break.
  const columnSubjectKey = (
    subject: StableId,
    action: Action,
  ): string | undefined => {
    const slot = columnCreateSlot(action, subject, desired);
    if (slot === undefined) return undefined;
    // Group each table's columns together (schema+table prefix), then order
    // within by zero-padded attnum. Every column create uses this same shape, so
    // the total order stays deterministic.
    return `column\x00${slot.tableKey}\x00${String(slot.position).padStart(6, "0")}`;
  };
  const order = topoSort(
    actions.length,
    edges,
    (i) =>
      actionTieKey(
        actions,
        i,
        rulesForId,
        columnSubjectKey,
        evaluatorActions,
        overlayWipeActions,
      ),
    (i) => (actions[i] as Action).sql,
  );

  // ── commitBoundaryAfter segment boundary (§3.8) ───────────────────────
  // Mark the FIRST graph successor of each commitBoundaryAfter action with
  // newSegmentBefore. apply.ts already closes the segment unconditionally after
  // a commitBoundaryAfter action, so this flag's load-bearing role now is
  // COMPACTION PROTECTION — compaction refuses to fold a clause across a
  // newSegmentBefore boundary. `splitPlan` is a second producer: it runs
  // on an already-planned artifact so it cannot fight CREATE TABLE folding.
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

  // ── compaction (§3.6) ─────────────────────────────────────────────────
  // fold ADD COLUMN clauses into their bare CREATE TABLE (no edge may cross the
  // merge), drop a replace's redundant drop when the create reproduces the
  // identical statement, elide REVOKE/GRANT pairs that only re-materialize a
  // freshly-created object's built-in default ACL, trim the cosmetic leading
  // REVOKE off remaining third-party co-create grants, fold a co-created
  // object's owner ALTER into its CREATE (CREATE SCHEMA … AUTHORIZATION, or drop
  // an applier-redundant ALTER), merge same-object REVOKE ALL leaders, then
  // merge consecutive same-privilege co-create GRANTs into one grantee-list
  // statement (last, so it sees final adjacency).
  // Purely cosmetic — the proof is unchanged.
  const finalActions = compact
    ? mergeCoTargetGrants(
        mergeCoTargetRevokes(
          foldCoCreateOwnership(
            elideCoCreateRevokeBeforeGrant(
              elideDefaultAclCreates(
                elideCascadeSubsumedPolicyDrops(
                  elideRedundantDrops(
                    compactColumnFolds(
                      orderedActions,
                      order,
                      edges,
                      foldHints,
                      acceptsFolds,
                      positionOf,
                      foldConstraints,
                    ),
                    source,
                  ),
                  source,
                ),
                desired,
                capability,
              ),
              desired,
              capability,
              assumedDefaultGrants,
            ),
            desired,
            capability,
          ),
        ),
        desired,
      )
    : orderedActions;

  return {
    actions: finalActions,
    safetyReport: computeSafetyReport(finalActions),
  };
}
