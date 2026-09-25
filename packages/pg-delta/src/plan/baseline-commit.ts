/**
 * Optional lock-budget packing. `splitPlan` copies actions and sets
 * `newSegmentBefore` so each transactional segment's estimated lock
 * slots try to stay under `maxLocks`. Lives next to the planner so
 * `plan()` never imports apply. Extra COMMITs are only safe when
 * nothing else reads the target during apply.
 */
import { stampPlanId } from "./artifact.ts";
import type { Plan } from "./plan.ts";

/** Kinds that occupy a lock-table slot until COMMIT. */
export const LOCK_HOLDING_RELATION_KINDS = new Set([
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "sequence",
  "index",
  // PK/UNIQUE/EXCLUDE backing indexes are extracted as `constraint`, not
  // `index` (extract/relations.ts). They still hold a lock until COMMIT.
  "constraint",
  "type",
]);

/** Heap relations that also create a toast table + toast index. */
const TOAST_KINDS = new Set(["table", "materializedView"]);

export interface LockEstimateAction {
  verb: "create" | "alter" | "drop";
  produces: ReadonlyArray<{ kind: string }>;
  destroys: ReadonlyArray<{ kind: string }>;
  consumes?: ReadonlyArray<{ kind: string }>;
}

function relationLockSlots(kind: string): number {
  if (!LOCK_HOLDING_RELATION_KINDS.has(kind)) return 0;
  return TOAST_KINDS.has(kind) ? 3 : 1;
}

export function estimateActionLocks(action: LockEstimateAction): number {
  let n = 1;
  for (const id of action.produces) n += relationLockSlots(id.kind);
  for (const id of action.destroys) n += relationLockSlots(id.kind);
  // Existing subjects (ALTER / CREATE INDEX on a live table). Toast already
  // exists; count the relation once.
  for (const id of action.consumes ?? []) {
    if (LOCK_HOLDING_RELATION_KINDS.has(id.kind)) n += 1;
  }
  return n;
}

export function estimateSegmentLocks(
  actions: readonly LockEstimateAction[],
): number {
  let n = 0;
  for (const action of actions) n += estimateActionLocks(action);
  return n;
}

/** Copy `actions` and start a new segment when the next action would
 *  push the running `estimateActionLocks` sum over `maxLocks`. Does
 *  not split inside one action. A single action already over budget
 *  stays in its own segment. */
export function splitActions<
  T extends LockEstimateAction & { newSegmentBefore: boolean },
>(actions: readonly T[], maxLocks: number): T[] {
  if (!Number.isInteger(maxLocks)) {
    throw new Error(`maxLocks must be an integer, got ${String(maxLocks)}`);
  }
  // A probe can return available <= 0. Isolate each action and apply anyway.
  const cap = Math.max(1, maxLocks);
  const out = actions.map((action) => ({ ...action }));
  let running = 0;
  for (const action of out) {
    if (action.newSegmentBefore) running = 0;
    const cost = estimateActionLocks(action);
    if (running > 0 && running + cost > cap) {
      action.newSegmentBefore = true;
      running = 0;
    }
    running += cost;
  }
  return out;
}

/** Pack `plan.actions` under `maxLocks` and restamp `planId` so apply
 *  accepts the marked artifact. Unchanged marks keep the same digest.
 *  `maxLocks <= 0` (a depleted probe) isolates each action. */
export function splitPlan(thePlan: Plan, options: { maxLocks: number }): Plan {
  return stampPlanId({
    ...thePlan,
    actions: splitActions(thePlan.actions, options.maxLocks),
  });
}
