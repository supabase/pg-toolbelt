/**
 * End-to-end plan phases against a live Supabase Postgres container (Docker).
 *
 * Run: `cd packages/pg-delta && bun run bench:e2e`
 *
 * Requires Docker. Uses `PGDELTA_TEST_POSTGRES_VERSIONS` (default: `17`).
 */

import type { Pool } from "pg";
import { diffCatalogs } from "../src/core/catalog.diff.ts";
import {
  createEmptyCatalog,
  extractCatalog,
} from "../src/core/catalog.model.ts";
import {
  buildPlanScopeFingerprint,
  hashStableIds,
} from "../src/core/fingerprint.ts";
import { classifyChangesRisk } from "../src/core/plan/risk.ts";
import { createPool } from "../src/core/postgres-config.ts";
import { sortChanges } from "../src/core/sort/sort-changes.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type SupabasePostgresVersion,
} from "../tests/constants.ts";
import { SupabasePostgreSqlContainer } from "../tests/supabase-postgres.ts";
import { applySupabaseBaseInit, waitForPool } from "../tests/utils.ts";
import { generateLargeSchemaSql } from "./large-schema-generator.ts";

const WARMUP = 3;
const ITERS = 5;

const E2E_TABLE_COUNT = Number(
  process.env.BENCH_E2E_TABLE_COUNT ?? process.env.BENCH_TABLE_COUNT ?? "400",
);
if (
  !Number.isInteger(E2E_TABLE_COUNT) ||
  E2E_TABLE_COUNT < 1 ||
  E2E_TABLE_COUNT > 50_000
) {
  console.error(
    `[bench:e2e] BENCH_E2E_TABLE_COUNT / BENCH_TABLE_COUNT must be integer 1..50000, got ${String(process.env.BENCH_E2E_TABLE_COUNT ?? process.env.BENCH_TABLE_COUNT ?? "400")}`,
  );
  process.exit(1);
}

function median(nums: readonly number[]): number {
  if (nums.length === 0) return Number.NaN;
  const s = [...nums].sort((a, b) => a - b);
  const v = s[Math.floor(s.length / 2)];
  return v === undefined ? Number.NaN : v;
}

function nsToMs(ns: number): string {
  return (ns / 1e6).toFixed(2);
}

async function measurePhases(branchPool: Pool): Promise<{
  extractMs: number;
  emptyBaselineMs: number;
  diffMs: number;
  sortMs: number;
  planMs: number;
}> {
  const extractSamples: number[] = [];
  const emptySamples: number[] = [];
  const diffSamples: number[] = [];
  const sortSamples: number[] = [];
  const planSamples: number[] = [];

  for (let i = 0; i < WARMUP + ITERS; i++) {
    const t0 = Bun.nanoseconds();
    const branchCat = await extractCatalog(branchPool);
    const t1 = Bun.nanoseconds();
    const fromCat = await createEmptyCatalog(
      branchCat.version,
      branchCat.currentUser,
    );
    const t2 = Bun.nanoseconds();
    const changes = diffCatalogs(fromCat, branchCat, {});
    const t3 = Bun.nanoseconds();
    const sorted = sortChanges(
      { mainCatalog: fromCat, branchCatalog: branchCat },
      changes,
    );
    const t4 = Bun.nanoseconds();
    classifyChangesRisk(sorted);
    for (const c of sorted) {
      c.serialize();
    }
    const { stableIds } = buildPlanScopeFingerprint(fromCat, sorted);
    hashStableIds(branchCat, stableIds);
    const t5 = Bun.nanoseconds();

    if (i < WARMUP) continue;
    extractSamples.push(t1 - t0);
    emptySamples.push(t2 - t1);
    diffSamples.push(t3 - t2);
    sortSamples.push(t4 - t3);
    planSamples.push(t5 - t4);
  }

  return {
    extractMs: median(extractSamples),
    emptyBaselineMs: median(emptySamples),
    diffMs: median(diffSamples),
    sortMs: median(sortSamples),
    planMs: median(planSamples),
  };
}

function formatRow(
  mode: string,
  pg: SupabasePostgresVersion,
  m: {
    extractMs: number;
    emptyBaselineMs: number;
    diffMs: number;
    sortMs: number;
    planMs: number;
  },
): string {
  const total =
    m.extractMs + m.emptyBaselineMs + m.diffMs + m.sortMs + m.planMs;
  const pct = (x: number) =>
    total > 0 ? `${((100 * x) / total).toFixed(1)}%` : "—";
  return (
    `| ${mode} | pg${pg} | ${nsToMs(m.extractMs)} (${pct(m.extractMs)}) | ` +
    `${nsToMs(m.emptyBaselineMs)} (${pct(m.emptyBaselineMs)}) | ` +
    `${nsToMs(m.diffMs)} (${pct(m.diffMs)}) | ` +
    `${nsToMs(m.sortMs)} (${pct(m.sortMs)}) | ` +
    `${nsToMs(m.planMs)} (${pct(m.planMs)}) | ${nsToMs(total)} |`
  );
}

const versionsRaw = process.env.PGDELTA_TEST_POSTGRES_VERSIONS?.split(",") ?? [
  "17",
];
const versions = versionsRaw
  .map((v) => Number(v) as SupabasePostgresVersion)
  .filter((v) => v in POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG);

if (versions.length === 0) {
  console.log(
    "No valid Supabase postgres versions in PGDELTA_TEST_POSTGRES_VERSIONS",
  );
  process.exit(0);
}

console.error(
  `[bench:e2e] synthetic schema: ${E2E_TABLE_COUNT} tables; postgres_fdw loopback; security labels if BENCH_SECURITY_LABELS=1`,
);

console.log(
  "| mode | PG | extract | emptyBaseline | diff | sort | planBuild | total_ms |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");

type StartedSupabase = Awaited<
  ReturnType<InstanceType<typeof SupabasePostgreSqlContainer>["start"]>
>;

for (const pgVersion of versions) {
  const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[pgVersion]}`;
  let pool: Pool | undefined;
  let container: StartedSupabase | undefined;
  try {
    container = await new SupabasePostgreSqlContainer(image).start();
    pool = createPool(container.getConnectionUri(), {
      connectionTimeoutMillis: 30_000,
    });
    await waitForPool(pool);
    await applySupabaseBaseInit(pool, pgVersion);

    const mA = await measurePhases(pool);
    console.log(formatRow("base-init only", pgVersion, mA));

    const largeSql = generateLargeSchemaSql({
      tableCount: E2E_TABLE_COUNT,
      includeSecurityLabels: process.env.BENCH_SECURITY_LABELS === "1",
      fdwLoopback: {
        host: "127.0.0.1",
        port: 5432,
        dbname: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
      },
    });
    await pool.query(largeSql);
    const mB = await measurePhases(pool);
    console.log(
      formatRow(`+ synthetic schema (N=${E2E_TABLE_COUNT})`, pgVersion, mB),
    );
  } catch (e) {
    console.error(`[bench:e2e] pg${pgVersion} failed:`, e);
    console.error(
      "Ensure Docker is running and the Supabase image can be pulled.",
    );
    process.exitCode = 1;
    break;
  } finally {
    await pool?.end().catch(() => {});
    await container?.stop().catch(() => {});
  }
}
