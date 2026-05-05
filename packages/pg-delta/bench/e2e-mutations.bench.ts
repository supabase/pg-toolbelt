/**
 * Two-database E2E: identical Supabase baseline + synthetic schema on **main**
 * and **branch**, then diverse ALTER/DROP mutations on **branch** only.
 * Times double extract + diff(sort(plan)) — exercises drops/alters vs empty-baseline `e2e.bench.ts`.
 *
 * New DBs are `CREATE DATABASE … WITH TEMPLATE postgres` after `applySupabaseBaseInit`
 * on `postgres`, so clones include `auth` and the rest of the Supabase fixture (template1
 * alone does not).
 *
 * Run: `cd packages/pg-delta && bun run bench:e2e-mutations`
 */

import type { Pool } from "pg";
import { diffCatalogs } from "../src/core/catalog.diff.ts";
import { extractCatalog } from "../src/core/catalog.model.ts";
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
import {
  generateBranchMutationsSql,
  maxBranchMutationCount,
} from "./branch-mutations-generator.ts";
import { generateLargeSchemaSql } from "./large-schema-generator.ts";

const WARMUP = 3;
const ITERS = 5;

const MAIN_DB = "pgdelta_bench_main";
const BRANCH_DB = "pgdelta_bench_branch";

/** Cluster-global roles: distinct per logical DB on one Postgres instance. */
const BENCH_ROLES_MAIN = {
  shadow: "bench_shadow_main",
  actor: "bench_actor_main",
} as const;
const BENCH_ROLES_BRANCH = {
  shadow: "bench_shadow_branch",
  actor: "bench_actor_branch",
} as const;

const E2E_TABLE_COUNT = Number(
  process.env.BENCH_E2E_TABLE_COUNT ?? process.env.BENCH_TABLE_COUNT ?? "400",
);
if (
  !Number.isInteger(E2E_TABLE_COUNT) ||
  E2E_TABLE_COUNT < 1 ||
  E2E_TABLE_COUNT > 50_000
) {
  console.error(
    `[bench:e2e-mutations] invalid BENCH_E2E_TABLE_COUNT / BENCH_TABLE_COUNT`,
  );
  process.exit(1);
}

const E2E_MUTATION_COUNT = Number(process.env.BENCH_E2E_MUTATION_COUNT ?? "32");
if (!Number.isInteger(E2E_MUTATION_COUNT) || E2E_MUTATION_COUNT < 0) {
  console.error(
    `[bench:e2e-mutations] BENCH_E2E_MUTATION_COUNT must be a non-negative integer`,
  );
  process.exit(1);
}

const maxMut = maxBranchMutationCount(E2E_TABLE_COUNT, BENCH_ROLES_BRANCH);
const effectiveMutationCount = Math.min(E2E_MUTATION_COUNT, maxMut);

function connectionUriForDatabase(baseUri: string, database: string): string {
  const u = new URL(baseUri);
  u.pathname = `/${database}`;
  return u.toString();
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

async function measureFullDiffPhases(
  mainPool: Pool,
  branchPool: Pool,
): Promise<{
  extractMainMs: number;
  extractBranchMs: number;
  diffMs: number;
  sortMs: number;
  planMs: number;
}> {
  const mainSamples: number[] = [];
  const branchSamples: number[] = [];
  const diffSamples: number[] = [];
  const sortSamples: number[] = [];
  const planSamples: number[] = [];

  for (let i = 0; i < WARMUP + ITERS; i++) {
    const t0 = Bun.nanoseconds();
    const mainCat = await extractCatalog(mainPool);
    const t1 = Bun.nanoseconds();
    const branchCat = await extractCatalog(branchPool);
    const t2 = Bun.nanoseconds();
    const changes = diffCatalogs(mainCat, branchCat, {});
    const t3 = Bun.nanoseconds();
    const sorted = sortChanges(
      { mainCatalog: mainCat, branchCatalog: branchCat },
      changes,
    );
    const t4 = Bun.nanoseconds();
    classifyChangesRisk(sorted);
    for (const c of sorted) {
      c.serialize();
    }
    const { stableIds } = buildPlanScopeFingerprint(mainCat, sorted);
    hashStableIds(branchCat, stableIds);
    const t5 = Bun.nanoseconds();

    if (i < WARMUP) continue;
    mainSamples.push(t1 - t0);
    branchSamples.push(t2 - t1);
    diffSamples.push(t3 - t2);
    sortSamples.push(t4 - t3);
    planSamples.push(t5 - t4);
  }

  return {
    extractMainMs: median(mainSamples),
    extractBranchMs: median(branchSamples),
    diffMs: median(diffSamples),
    sortMs: median(sortSamples),
    planMs: median(planSamples),
  };
}

function formatRow(
  mode: string,
  pg: SupabasePostgresVersion,
  m: {
    extractMainMs: number;
    extractBranchMs: number;
    diffMs: number;
    sortMs: number;
    planMs: number;
  },
): string {
  const total =
    m.extractMainMs + m.extractBranchMs + m.diffMs + m.sortMs + m.planMs;
  const pct = (x: number) =>
    total > 0 ? `${((100 * x) / total).toFixed(1)}%` : "—";
  return (
    `| ${mode} | pg${pg} | ${nsToMs(m.extractMainMs)} (${pct(m.extractMainMs)}) | ` +
    `${nsToMs(m.extractBranchMs)} (${pct(m.extractBranchMs)}) | ` +
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
  `[bench:e2e-mutations] N=${E2E_TABLE_COUNT} tables; mutations=${effectiveMutationCount}/${maxMut} (BENCH_E2E_MUTATION_COUNT=${E2E_MUTATION_COUNT}); two DBs ${MAIN_DB} / ${BRANCH_DB}`,
);

console.log(
  "| mode | PG | extractMain | extractBranch | diff | sort | planBuild | total_ms |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");

type StartedSupabase = Awaited<
  ReturnType<InstanceType<typeof SupabasePostgreSqlContainer>["start"]>
>;

for (const pgVersion of versions) {
  const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[pgVersion]}`;
  let adminPool: Pool | undefined;
  let mainPool: Pool | undefined;
  let branchPool: Pool | undefined;
  let container: StartedSupabase | undefined;
  try {
    container = await new SupabasePostgreSqlContainer(image).start();
    const baseUri = container.getConnectionUri();
    const templateUri = connectionUriForDatabase(baseUri, "template1");

    const bootstrapPool = createPool(baseUri, {
      connectionTimeoutMillis: 30_000,
    });
    await waitForPool(bootstrapPool);
    await applySupabaseBaseInit(bootstrapPool, pgVersion);
    await bootstrapPool.end();

    adminPool = createPool(templateUri, { connectionTimeoutMillis: 30_000 });
    await waitForPool(adminPool);

    await adminPool.query(`DROP DATABASE IF EXISTS ${MAIN_DB} WITH (FORCE)`);
    await adminPool.query(`DROP DATABASE IF EXISTS ${BRANCH_DB} WITH (FORCE)`);

    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postgres' AND pid <> pg_backend_pid()`,
    );
    await adminPool.query(`CREATE DATABASE ${MAIN_DB} WITH TEMPLATE postgres`);
    await adminPool.query(
      `CREATE DATABASE ${BRANCH_DB} WITH TEMPLATE postgres`,
    );
    await adminPool.end();
    adminPool = undefined;

    const mainUri = connectionUriForDatabase(baseUri, MAIN_DB);
    const branchUri = connectionUriForDatabase(baseUri, BRANCH_DB);

    mainPool = createPool(mainUri, { connectionTimeoutMillis: 30_000 });
    branchPool = createPool(branchUri, { connectionTimeoutMillis: 30_000 });
    await waitForPool(mainPool);
    await waitForPool(branchPool);

    const includeSec = process.env.BENCH_SECURITY_LABELS === "1";
    const largeMain = generateLargeSchemaSql({
      tableCount: E2E_TABLE_COUNT,
      includeSecurityLabels: includeSec,
      benchRoles: BENCH_ROLES_MAIN,
      fdwLoopback: {
        host: "127.0.0.1",
        port: 5432,
        dbname: MAIN_DB,
        user: container.getUsername(),
        password: container.getPassword(),
      },
    });
    const largeBranch = generateLargeSchemaSql({
      tableCount: E2E_TABLE_COUNT,
      includeSecurityLabels: includeSec,
      benchRoles: BENCH_ROLES_BRANCH,
      fdwLoopback: {
        host: "127.0.0.1",
        port: 5432,
        dbname: BRANCH_DB,
        user: container.getUsername(),
        password: container.getPassword(),
      },
    });

    await mainPool.query(largeMain);
    await branchPool.query(largeBranch);

    const mIdentical = await measureFullDiffPhases(mainPool, branchPool);
    console.log(formatRow("twin schema (no mutations)", pgVersion, mIdentical));

    const mutSql = generateBranchMutationsSql({
      tableCount: E2E_TABLE_COUNT,
      mutationCount: effectiveMutationCount,
      benchRoles: BENCH_ROLES_BRANCH,
    });
    await branchPool.query(mutSql);

    const mDiverged = await measureFullDiffPhases(mainPool, branchPool);
    console.log(
      formatRow(
        `+ branch mutations (M=${effectiveMutationCount})`,
        pgVersion,
        mDiverged,
      ),
    );
  } catch (e) {
    console.error(`[bench:e2e-mutations] pg${pgVersion} failed:`, e);
    console.error(
      "Ensure Docker is running and the Supabase image can be pulled.",
    );
    process.exitCode = 1;
    break;
  } finally {
    await adminPool?.end().catch(() => {});
    await mainPool?.end().catch(() => {});
    await branchPool?.end().catch(() => {});
    if (container) {
      const cleanupUri = container.getConnectionUri();
      const p = createPool(cleanupUri, { connectionTimeoutMillis: 15_000 });
      try {
        await waitForPool(p);
        await p.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ($1, $2) AND pid <> pg_backend_pid()`,
          [MAIN_DB, BRANCH_DB],
        );
        await p.query(`DROP DATABASE IF EXISTS ${MAIN_DB} WITH (FORCE)`);
        await p.query(`DROP DATABASE IF EXISTS ${BRANCH_DB} WITH (FORCE)`);
      } catch {
        /* best-effort */
      }
      await p.end().catch(() => {});
    }
    await container?.stop().catch(() => {});
  }
}
