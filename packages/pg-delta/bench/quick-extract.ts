/**
 * Fast-iteration bench against a long-running benchmark database (see
 * `bench/serve-db.ts`). Reads `BENCH_DB_URL` from env and runs `extractCatalog`
 * a few times, with deep timing breakdowns: server-side vs client-side, plus a
 * dedicated `extractDepends` split (server query vs JS post-process).
 *
 * Usage:
 *
 *   bun bench/serve-db.ts > /tmp/bench-db.log 2>&1 &
 *   # wait for "READY url=" line
 *   export BENCH_DB_URL="$(grep '^READY url=' /tmp/bench-db.log | sed 's/READY url=//')"
 *   bun bench/quick-extract.ts
 */

import type { Pool } from "pg";
import { extractCatalog } from "../src/core/catalog.model.ts";
import {
  DEPENDS_SQL,
  extractDepends,
  PRIVILEGE_AND_MEMBERSHIP_DEPENDS_SQL,
} from "../src/core/depend.ts";
import { createPool } from "../src/core/postgres-config.ts";

const url = process.env.BENCH_DB_URL;
if (!url) {
  console.error(
    "BENCH_DB_URL not set. Start `bun bench/serve-db.ts` first and export the URL.",
  );
  process.exit(1);
}

const ITERS = Number(process.env.BENCH_ITERS ?? "5");
const WARMUP = Number(process.env.BENCH_WARMUP ?? "2");

const pool = createPool(url, { connectionTimeoutMillis: 30_000 });

function nsToMs(ns: number): string {
  return (ns / 1e6).toFixed(2);
}
function median(nums: readonly number[]): number {
  if (nums.length === 0) return Number.NaN;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
}

interface DependsBreakdown {
  totalNs: number;
  // raw query times (await pool.query()) — includes server exec + wire + parse
  dependsSqlNs: number;
  privSqlNs: number;
  // JS-only post-process time (concat + sort)
  postProcessNs: number;
  rowsDepends: number;
  rowsPriv: number;
}

async function timedExtractDepends(p: Pool): Promise<DependsBreakdown> {
  const t0 = Bun.nanoseconds();
  // Run sequential to isolate each query's wire+parse cost
  const tDepends0 = Bun.nanoseconds();
  const dependsResult = await p.query(DEPENDS_SQL);
  const tDepends1 = Bun.nanoseconds();
  const privResult = await p.query(PRIVILEGE_AND_MEMBERSHIP_DEPENDS_SQL);
  const tPriv1 = Bun.nanoseconds();

  const tPost0 = Bun.nanoseconds();
  const merged = (dependsResult.rows as unknown[]).concat(
    privResult.rows as unknown[],
  );
  const sortable = merged as Array<{
    dependent_stable_id: string;
    referenced_stable_id: string;
  }>;
  sortable.sort((a, b) => {
    if (a.dependent_stable_id < b.dependent_stable_id) return -1;
    if (a.dependent_stable_id > b.dependent_stable_id) return 1;
    if (a.referenced_stable_id < b.referenced_stable_id) return -1;
    if (a.referenced_stable_id > b.referenced_stable_id) return 1;
    return 0;
  });
  const tPost1 = Bun.nanoseconds();

  return {
    totalNs: tPost1 - t0,
    dependsSqlNs: tDepends1 - tDepends0,
    privSqlNs: tPriv1 - tDepends1,
    postProcessNs: tPost1 - tPost0,
    rowsDepends: dependsResult.rows.length,
    rowsPriv: privResult.rows.length,
  };
}

async function timedExtractCatalog(p: Pool): Promise<{
  totalNs: number;
  dependsNs: number;
}> {
  const t0 = Bun.nanoseconds();
  const cat = await extractCatalog(p);
  const t1 = Bun.nanoseconds();
  // Also run a dedicated extractDepends after catalog so we measure depends
  // fresh (caches warm). Cheaper: just record from internal timing.
  void cat;
  return {
    totalNs: t1 - t0,
    // We can't peel out depends inside catalog without modifying source;
    // record below in a separate pass.
    dependsNs: 0,
  };
}

try {
  console.log(
    `bench:quick-extract — url=${url.replace(/:[^@]+@/, ":***@")}, iters=${ITERS} warmup=${WARMUP}`,
  );

  // Pass 1: extractCatalog wall
  const catalogSamples: number[] = [];
  for (let i = 0; i < WARMUP + ITERS; i++) {
    const r = await timedExtractCatalog(pool);
    if (i >= WARMUP) catalogSamples.push(r.totalNs);
  }

  // Pass 2: extractDepends only with breakdown
  const dependsSamples: DependsBreakdown[] = [];
  for (let i = 0; i < WARMUP + ITERS; i++) {
    const b = await timedExtractDepends(pool);
    if (i >= WARMUP) dependsSamples.push(b);
  }

  // Pass 3: extractDepends production code (uses Set/sort etc.)
  const dependsProdSamples: number[] = [];
  for (let i = 0; i < WARMUP + ITERS; i++) {
    const t0 = Bun.nanoseconds();
    const out = await extractDepends(pool);
    const t1 = Bun.nanoseconds();
    if (i >= WARMUP) {
      dependsProdSamples.push(t1 - t0);
      if (i === WARMUP) console.log(`  extractDepends rows=${out.length}`);
    }
  }

  console.log(
    `\nextractCatalog wall p50: **${nsToMs(median(catalogSamples))} ms**\n`,
  );

  const dSqlMed = median(dependsSamples.map((s) => s.dependsSqlNs));
  const pSqlMed = median(dependsSamples.map((s) => s.privSqlNs));
  const postMed = median(dependsSamples.map((s) => s.postProcessNs));
  const totMed = median(dependsSamples.map((s) => s.totalNs));
  const rowsD = dependsSamples[0]?.rowsDepends ?? 0;
  const rowsP = dependsSamples[0]?.rowsPriv ?? 0;
  const prodMed = median(dependsProdSamples);

  console.log("extractDepends breakdown (sequential, p50):");
  console.log(
    `  DEPENDS_SQL                       : ${nsToMs(dSqlMed)} ms (${rowsD} rows)`,
  );
  console.log(
    `  PRIVILEGE_AND_MEMBERSHIP_DEPENDS  : ${nsToMs(pSqlMed)} ms (${rowsP} rows)`,
  );
  console.log(`  JS post-process (concat + sort)   : ${nsToMs(postMed)} ms`);
  console.log(`  TOTAL inline                      : ${nsToMs(totMed)} ms`);
  console.log(
    `  TOTAL extractDepends() prod call  : ${nsToMs(prodMed)} ms (oracle)`,
  );
} finally {
  await pool.end();
}
