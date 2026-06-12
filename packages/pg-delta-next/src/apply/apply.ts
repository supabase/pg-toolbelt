/**
 * Execution (target-architecture §3.8): sequential, per-statement error
 * attribution. v1: all supported actions are transactional, so the plan
 * runs as one transaction; the three-valued segmentation (nonTransactional,
 * commitBoundaryAfter) lands with the kinds that need it.
 */
import type { Pool } from "pg";
import type { Plan } from "../plan/plan.ts";

export interface ApplyReport {
  status: "applied" | "failed";
  appliedActions: number;
  error?: { actionIndex: number; sql: string; message: string };
}

export async function apply(thePlan: Plan, target: Pool): Promise<ApplyReport> {
  const client = await target.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL check_function_bodies = off");
    for (let i = 0; i < thePlan.actions.length; i++) {
      const action = thePlan.actions[i]!;
      try {
        await client.query(action.sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        return {
          status: "failed",
          appliedActions: i,
          error: {
            actionIndex: i,
            sql: action.sql,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
    await client.query("COMMIT");
    return { status: "applied", appliedActions: thePlan.actions.length };
  } finally {
    client.release();
  }
}
