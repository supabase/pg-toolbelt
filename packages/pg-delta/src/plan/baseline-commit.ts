/**
 * Opt-in `baselineCommitEvery` marks. After compaction the planner (or apply,
 * on a working copy) sets `newSegmentBefore` every N created lock-holding
 * relations. Lives next to the planner so `plan()` does not import apply.
 */

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

function lockHoldingCreates(action: {
  produces: ReadonlyArray<{ kind: string }>;
}): number {
  let n = 0;
  for (const id of action.produces) {
    if (LOCK_HOLDING_RELATION_KINDS.has(id.kind)) n += 1;
  }
  return n;
}

/** Copy `actions` and set `newSegmentBefore` after every `every` created
 *  lock-holding relations. Does not split inside a single action. */
export function markBaselineCommitBoundaries<
  T extends {
    produces: ReadonlyArray<{ kind: string }>;
    newSegmentBefore: boolean;
  },
>(actions: readonly T[], every: number): T[] {
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(
      `baselineCommitEvery must be a positive integer, got ${String(every)}`,
    );
  }
  const out = actions.map((action) => ({ ...action }));
  let created = 0;
  for (let i = 0; i < out.length; i++) {
    created += lockHoldingCreates(out[i]!);
    if (created >= every) {
      const next = i + 1;
      if (next < out.length) out[next]!.newSegmentBefore = true;
      created = 0;
    }
  }
  return out;
}
