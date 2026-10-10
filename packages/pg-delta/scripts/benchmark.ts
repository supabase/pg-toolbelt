#!/usr/bin/env bun
/**
 * The benchmark fixture + timing harness (stage 5 deliverable 8): a
 * ≥10k-object schema and extract/diff/plan wall-times. Stage 10's
 * performance-parity bar reads these numbers; run it in CI so regressions
 * surface long before cutover.
 *
 *   bun scripts/benchmark.ts             # spins a disposable container
 *   bun scripts/benchmark.ts <pg-url>    # uses an existing server
 *
 * The <pg-url> server must be disposable: the fixture (its schemas and the
 * cluster-wide `bench_reader` and Supabase roles) is left in place.
 *
 * Set PGDELTA_BENCH_PER_QUERY=1 to additionally attribute the cold extract's
 * wall-time per SQL round-trip (milestone A "profile first") — it wraps the
 * pooled client's `query` for the duration of that one extract, then restores
 * it, so the rest of the run is unaffected.
 */
import pg from "pg";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import {
  COLUMNS_PER_TABLE,
  fixtureSql,
  MUTATIONS,
  SCHEMAS,
  TABLES_PER_SCHEMA,
} from "./bench/fixture.ts";
import { withPerQueryTiming, type QueryTiming } from "./perf-timing.ts";

const PER_QUERY = process.env["PGDELTA_BENCH_PER_QUERY"] === "1";

/** Print every query's timing, sorted slowest-first. The wrapper that
 *  collects them (`withPerQueryTiming`) lives in ./perf-timing.ts, shared
 *  with scripts/stress.ts. */
function printPerQueryTiming(timings: QueryTiming[]): void {
  let sum = 0;
  console.log(`\nper-query breakdown (${timings.length} queries):`);
  console.log(`${"ms".padStart(8)} ${"rows".padStart(7)}  query`);
  for (const t of timings) {
    sum += t.ms;
    console.log(
      `${t.ms.toFixed(1).padStart(8)} ${String(t.rows).padStart(7)}  ${t.label}`,
    );
  }
  console.log(`sum of query time: ${sum.toFixed(0)} ms\n`);
}

async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`${label.padEnd(28)} ${ms.toFixed(0).padStart(8)} ms`);
  return result;
}

const url = process.argv[2];
let pool: pg.Pool;
let cleanup = async (): Promise<void> => {};
if (url !== undefined) {
  pool = new pg.Pool({ connectionString: url, max: 2 });
  cleanup = async () => {
    await pool.end();
  };
} else {
  const { sharedCluster } = await import("../tests/containers.ts");
  const cluster = await sharedCluster();
  const db = await cluster.createDb("bench");
  pool = db.pool;
  cleanup = async () => {
    await db.drop();
    process.exit(0);
  };
}

console.log(
  `fixture: ${SCHEMAS} schemas x ${TABLES_PER_SCHEMA} tables x ${COLUMNS_PER_TABLE} columns`,
);
await timed("load fixture DDL", () => pool.query(fixtureSql()));

const before = await timed("extract (cold)", async () => {
  if (!PER_QUERY) return extract(pool);
  const { result, timings } = await withPerQueryTiming(pool, () =>
    extract(pool),
  );
  printPerQueryTiming(timings);
  return result;
});
console.log(`fact count: ${before.factBase.facts().length}`);

await pool.query(MUTATIONS);
const after = await timed("extract (mutated)", () => extract(pool));

const deltas = await timed("diff", () => diff(before.factBase, after.factBase));
console.log(`delta count: ${deltas.length}`);

const thePlan = await timed("plan (incremental)", () =>
  plan(before.factBase, after.factBase),
);
console.log(`action count: ${thePlan.actions.length}`);

await timed("plan (full materialize)", async () => {
  const { buildFactBase } = await import("../src/core/fact.ts");
  return plan(buildFactBase([], []), after.factBase);
});

await cleanup();
