/**
 * The proof loop (target-architecture §3.7), as a product API.
 * Materialization (template clone / render-from-fact-base) is the caller's
 * concern; this module owns the two checks:
 *   1. state proof — apply, re-extract, zero drift deltas
 *   2. data preservation — pre-seeded rows survive in surviving tables
 */
import type { Pool } from "pg";
import { apply } from "../apply/apply.ts";
import { diff, type Delta } from "../core/diff.ts";
import type { FactBase } from "../core/fact.ts";
import { extract } from "../extract/extract.ts";
import type { Plan } from "../plan/plan.ts";

export interface ProofVerdict {
  ok: boolean;
  applyError?: { actionIndex: number; sql: string; message: string };
  driftDeltas: Delta[];
  dataViolations: Array<{ table: string; before: number; after: number }>;
}

async function tableRowCounts(pool: Pool): Promise<Map<string, number>> {
  const res = await pool.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
  const counts = new Map<string, number>();
  for (const row of res.rows as { schema: string; name: string }[]) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM "${row.schema.replaceAll('"', '""')}"."${row.name.replaceAll('"', '""')}"`,
    );
    counts.set(`${row.schema}.${row.name}`, (r.rows[0] as { n: number }).n);
  }
  return counts;
}

/**
 * Prove a plan against a sacrificial clone of the source. The clone is
 * mutated; never pass a real target.
 */
export async function provePlan(
  thePlan: Plan,
  clonePool: Pool,
  desired: FactBase,
): Promise<ProofVerdict> {
  const before = await tableRowCounts(clonePool);
  // the proof re-extracts after applying anyway; the fingerprint gate's
  // extra extraction is redundant here (it has its own execution tests)
  const report = await apply(thePlan, clonePool, { fingerprintGate: false });
  if (report.status !== "applied") {
    return {
      ok: false,
      ...(report.error ? { applyError: report.error } : {}),
      driftDeltas: [],
      dataViolations: [],
    };
  }
  const proven = await extract(clonePool);
  const driftDeltas = diff(proven.factBase, desired);
  const after = await tableRowCounts(clonePool);
  const dataViolations: ProofVerdict["dataViolations"] = [];
  for (const [table, count] of before) {
    const post = after.get(table);
    if (post !== undefined && post !== count) {
      dataViolations.push({ table, before: count, after: post });
    }
  }
  return {
    ok: driftDeltas.length === 0 && dataViolations.length === 0,
    driftDeltas,
    dataViolations,
  };
}
