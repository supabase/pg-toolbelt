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
 * Set PGDELTA_BENCH_PER_QUERY=1 to additionally attribute the cold extract's
 * wall-time per SQL round-trip (milestone A "profile first") — it wraps the
 * pooled client's `query` for the duration of that one extract, then restores
 * it, so the rest of the run is unaffected.
 */
import pg from "pg";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";

const PER_QUERY = process.env["PGDELTA_BENCH_PER_QUERY"] === "1";

/** Identify which extractor a SQL string belongs to: the first FROM relation
 *  plus a short head. Good enough to rank the ~36 extraction queries. */
function queryLabel(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  return `${(from?.[1] ?? "?").padEnd(20)} ${flat.slice(0, 44)}`;
}

/** Wrap the next-checked-out client's `query` to time each call, run `fn`, then
 *  restore `pool.connect`. Prints a sorted breakdown. Measurement only — never
 *  touches the library. */
async function withPerQueryTiming<T>(
  pool: pg.Pool,
  fn: () => Promise<T>,
): Promise<T> {
  const timings: { ms: number; rows: number; label: string }[] = [];
  const origConnect = pool.connect.bind(pool);
  (pool as { connect: unknown }).connect = async (...args: unknown[]) => {
    const client = await (
      origConnect as (...a: unknown[]) => Promise<pg.PoolClient>
    )(...args);
    const origQuery = client.query.bind(client) as (
      ...a: unknown[]
    ) => Promise<{ rows: unknown[] }>;
    (client as { query: unknown }).query = (...qa: unknown[]) => {
      const sql = typeof qa[0] === "string" ? qa[0] : String(qa[0]);
      const start = performance.now();
      const ret = origQuery(...qa) as unknown;
      // pg's client.query has a callback overload that returns void, not a
      // promise (pg-pool uses it internally) — only time the promise form.
      if (
        ret == null ||
        typeof (ret as { then?: unknown }).then !== "function"
      ) {
        return ret;
      }
      return (ret as Promise<{ rows: unknown[] }>).then((r) => {
        timings.push({
          ms: performance.now() - start,
          rows: r.rows.length,
          label: queryLabel(sql),
        });
        return r;
      });
    };
    return client;
  };
  try {
    return await fn();
  } finally {
    (pool as { connect: unknown }).connect = origConnect;
    timings.sort((a, b) => b.ms - a.ms);
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
}

const SCHEMAS = 40;
const TABLES_PER_SCHEMA = 15;
const COLUMNS_PER_TABLE = 8;

function fixtureSql(): string {
  const parts: string[] = [];
  for (let s = 0; s < SCHEMAS; s++) {
    const schema = `bench_${String(s).padStart(2, "0")}`;
    parts.push(`CREATE SCHEMA ${schema};`);
    parts.push(
      `CREATE TYPE ${schema}.status AS ENUM ('a', 'b', 'c');`,
      `CREATE SEQUENCE ${schema}.ids;`,
      `CREATE FUNCTION ${schema}.f(a integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT a + 1';`,
    );
    for (let t = 0; t < TABLES_PER_SCHEMA; t++) {
      const table = `${schema}.t${String(t).padStart(2, "0")}`;
      const cols = [
        "id integer NOT NULL DEFAULT nextval('" + schema + ".ids')",
      ];
      for (let c = 0; c < COLUMNS_PER_TABLE; c++) {
        cols.push(
          c % 3 === 0
            ? `c${c} text`
            : c % 3 === 1
              ? `c${c} numeric(12,2) DEFAULT 0`
              : `c${c} timestamptz`,
        );
      }
      cols.push("PRIMARY KEY (id)");
      parts.push(`CREATE TABLE ${table} (${cols.join(", ")});`);
      parts.push(`CREATE INDEX t${t}_c0_idx_${s} ON ${table} (c0);`);
      if (t % 2 === 0) {
        parts.push(
          `CREATE VIEW ${schema}.v${t} AS SELECT id, c0 FROM ${table} WHERE id > 0;`,
        );
        parts.push(`COMMENT ON TABLE ${table} IS 'bench table ${t}';`);
      }
    }
  }
  return parts.join("\n");
}

const MUTATIONS = `
  CREATE SCHEMA bench_new;
  CREATE TABLE bench_new.extra (id integer PRIMARY KEY, note text);
  ALTER TABLE bench_00.t00 ADD COLUMN added_col integer DEFAULT 5;
  DROP VIEW bench_01.v0;
  COMMENT ON SCHEMA bench_02 IS 'mutated';
`;

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

const before = await timed("extract (cold)", () =>
  PER_QUERY ? withPerQueryTiming(pool, () => extract(pool)) : extract(pool),
);
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
