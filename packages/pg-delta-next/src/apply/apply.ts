/**
 * Execution (target-architecture §3.8, stage 6): sequential, lock-aware,
 * segmented. Actions self-declare transactionality; the executor groups
 * maximal transactional runs, isolates nonTransactional actions, and
 * honors the planner's commitBoundaryAfter segment boundaries.
 * Segmentation changes transaction boundaries only, never order.
 *
 * Mid-plan failure semantics are explicit: every action is reported
 * applied / unapplied / inDoubt. A failure inside a transaction segment
 * rolls that segment back (its actions report unapplied); earlier
 * segments are committed (applied); a failure AT commit reports the
 * segment inDoubt.
 */
import type { Pool } from "pg";
import { extract } from "../extract/extract.ts";
import { ENGINE_VERSION, type Plan } from "../plan/plan.ts";

export type ActionStatus = "applied" | "unapplied" | "inDoubt";

export interface ApplyReport {
  status: "applied" | "failed";
  /** count of actions in committed segments */
  appliedActions: number;
  /** one entry per plan action, in plan order */
  actionStatuses: ActionStatus[];
  error?: { actionIndex: number; sql: string; message: string };
}

export interface ApplyOptions {
  /** re-extract the target and require its fingerprint to equal the
   *  plan's source fingerprint (stage 6 deliverable 3). Defaults to ON;
   *  harnesses that just proved the fingerprint may skip it. */
  fingerprintGate?: boolean;
  /** per-segment lock/statement timeouts (operational policy) */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface Segment {
  /** indexes into plan.actions, contiguous and in order */
  start: number;
  end: number; // exclusive
  transactional: boolean;
}

/** Group actions into maximal transactional runs; nonTransactional actions
 *  run alone; newSegmentBefore forces a commit between two runs. */
export function segmentActions(
  actions: ReadonlyArray<{
    transactionality:
      | "transactional"
      | "nonTransactional"
      | "commitBoundaryAfter";
    newSegmentBefore: boolean;
  }>,
): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    if (action.transactionality === "nonTransactional") {
      if (i > start) segments.push({ start, end: i, transactional: true });
      segments.push({ start: i, end: i + 1, transactional: false });
      start = i + 1;
    } else if (action.newSegmentBefore && i > start) {
      segments.push({ start, end: i, transactional: true });
      start = i;
    }
  }
  if (start < actions.length) {
    segments.push({ start, end: actions.length, transactional: true });
  }
  return segments;
}

function errorEntry(
  actionIndex: number,
  sql: string,
  error: unknown,
): NonNullable<ApplyReport["error"]> {
  return {
    actionIndex,
    sql,
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function apply(
  thePlan: Plan,
  target: Pool,
  options?: ApplyOptions,
): Promise<ApplyReport> {
  if (thePlan.formatVersion !== 1) {
    throw new Error(
      `apply: unsupported plan formatVersion ${String(thePlan.formatVersion)}`,
    );
  }
  if (thePlan.engineVersion !== ENGINE_VERSION) {
    throw new Error(
      `apply: plan was produced by engine ${thePlan.engineVersion}, this engine is ${ENGINE_VERSION} — re-plan`,
    );
  }
  if (options?.fingerprintGate !== false) {
    const current = await extract(target);
    if (current.factBase.rootHash !== thePlan.source.fingerprint) {
      throw new Error(
        `apply: fingerprint gate failed — the target's state (${current.factBase.rootHash.slice(0, 12)}…) is not the plan's source (${thePlan.source.fingerprint.slice(0, 12)}…); re-plan against the current state`,
      );
    }
  }

  const statuses: ActionStatus[] = thePlan.actions.map(() => "unapplied");
  const segments = segmentActions(thePlan.actions);
  let appliedActions = 0;

  const client = await target.connect();
  try {
    const preamble = (local: boolean): string[] => [
      ...(options?.lockTimeoutMs !== undefined
        ? [
            `SET ${local ? "LOCAL " : ""}lock_timeout = ${options.lockTimeoutMs}`,
          ]
        : []),
      ...(options?.statementTimeoutMs !== undefined
        ? [
            `SET ${local ? "LOCAL " : ""}statement_timeout = ${options.statementTimeoutMs}`,
          ]
        : []),
      ...thePlan.preamble.map(
        (s) => `SET ${local ? "LOCAL " : ""}${s.name} = ${s.value}`,
      ),
    ];

    for (const segment of segments) {
      if (!segment.transactional) {
        // a lone non-transactional action; session-level settings, reset after
        const index = segment.start;
        const action = thePlan.actions[index]!;
        try {
          for (const sql of preamble(false)) await client.query(sql);
          await client.query(action.sql);
          await client.query("RESET ALL");
        } catch (error) {
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: errorEntry(index, action.sql, error),
          };
        }
        statuses[index] = "applied";
        appliedActions += 1;
        continue;
      }

      try {
        await client.query("BEGIN");
        for (const sql of preamble(true)) await client.query(sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        return {
          status: "failed",
          appliedActions,
          actionStatuses: statuses,
          error: errorEntry(segment.start, "BEGIN", error),
        };
      }
      for (let i = segment.start; i < segment.end; i++) {
        const action = thePlan.actions[i]!;
        try {
          await client.query(action.sql);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          return {
            status: "failed",
            appliedActions,
            actionStatuses: statuses,
            error: errorEntry(i, action.sql, error),
          };
        }
      }
      try {
        await client.query("COMMIT");
      } catch (error) {
        // the commit itself failed: the segment's fate is unknown
        for (let i = segment.start; i < segment.end; i++)
          statuses[i] = "inDoubt";
        await client.query("ROLLBACK").catch(() => {});
        return {
          status: "failed",
          appliedActions,
          actionStatuses: statuses,
          error: errorEntry(segment.start, "COMMIT", error),
        };
      }
      for (let i = segment.start; i < segment.end; i++) statuses[i] = "applied";
      appliedActions += segment.end - segment.start;
    }
  } finally {
    client.release();
  }
  return {
    status: "applied",
    appliedActions,
    actionStatuses: statuses,
  };
}
