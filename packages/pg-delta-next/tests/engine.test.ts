/**
 * The engine suite (stage 0 + stage 3): every corpus scenario through the
 * proof loop, in BOTH directions — apply(plan(A→B), clone(A)) must be
 * hash-identical to B, and seeded rows must survive in surviving tables.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { loadCorpus } from "./corpus.ts";
import { createTestDb, type TestDb } from "./containers.ts";

async function tableRowCounts(db: TestDb): Promise<Map<string, number>> {
  const res = await db.pool.query(`
    SELECT n.nspname AS schema, c.relname AS name,
           (SELECT count(*) FROM ONLY pg_catalog.pg_class x WHERE false) AS noop
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')`);
  const counts = new Map<string, number>();
  for (const row of res.rows as { schema: string; name: string }[]) {
    const r = await db.pool.query(
      `SELECT count(*)::int AS n FROM "${row.schema}"."${row.name}"`,
    );
    counts.set(`${row.schema}.${row.name}`, (r.rows[0] as { n: number }).n);
  }
  return counts;
}

async function proveDirection(
  name: string,
  fromSql: string,
  toSql: string,
  seed: string | undefined,
): Promise<void> {
  const source = await createTestDb("src");
  const desired = await createTestDb("dst");
  try {
    await source.pool.query(fromSql);
    await desired.pool.query(toSql);
    if (seed) await source.pool.query(seed);

    const [sourceState, desiredState] = [
      await extract(source.pool),
      await extract(desired.pool),
    ];
    const thePlan = plan(sourceState.factBase, desiredState.factBase);

    const clone = await source.clone();
    try {
      const before = await tableRowCounts(clone);
      const report = await apply(thePlan, clone.pool);
      if (report.status !== "applied") {
        throw new Error(
          `[${name}] apply failed at action ${report.error?.actionIndex}: ${report.error?.message}\n` +
            thePlan.actions.map((a, i) => `  ${i}: ${a.sql}`).join("\n"),
        );
      }
      // STATE PROOF
      const proven = await extract(clone.pool);
      const drift = diff(proven.factBase, desiredState.factBase);
      if (drift.length > 0) {
        throw new Error(
          `[${name}] state proof failed — ${drift.length} drift delta(s):\n` +
            drift
              .map((d) =>
                d.verb === "set"
                  ? `  set ${encodeId(d.id)}.${d.attr}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`
                  : d.verb === "add" || d.verb === "remove"
                    ? `  ${d.verb} ${encodeId(d.fact.id)}`
                    : `  ${d.verb} ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`,
              )
              .join("\n") +
            `\nplan was:\n` +
            thePlan.actions.map((a, i) => `  ${i}: ${a.sql}`).join("\n"),
        );
      }
      // DATA-PRESERVATION PROOF: rows in tables present before and after
      const after = await tableRowCounts(clone);
      for (const [tableKey, count] of before) {
        if (after.has(tableKey)) {
          expect(`${tableKey}=${after.get(tableKey)}`).toBe(`${tableKey}=${count}`);
        }
      }
    } finally {
      await clone.drop();
    }
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

describe("engine: corpus proof loop", () => {
  for (const scenario of loadCorpus()) {
    test(`${scenario.name} (a -> b)`, async () => {
      await proveDirection(scenario.name, scenario.a, scenario.b, scenario.seed);
    }, 120_000);

    test(`${scenario.name} (b -> a, teardown direction)`, async () => {
      await proveDirection(`${scenario.name}:reverse`, scenario.b, scenario.a, undefined);
    }, 120_000);
  }
});
