/**
 * `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)` capture for the catalog
 * extractor queries identified as hot by `bench:extract-breakdown`.
 *
 * Run: `cd packages/pg-delta && bun run bench:explain-extract`
 *
 * Reuses the container/base-init/synthetic-schema setup from `bench:e2e`.
 * For each target query (the SQL constant is the source of truth in `src/`),
 * runs the query once to warm caches, then captures both `FORMAT TEXT` and
 * `FORMAT JSON` plans and writes them to `bench/profiles/explain/`. A
 * top-level `SUMMARY.md` collates planning/exec time and total buffers.
 *
 * `bench/profiles/` is gitignored.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import {
  DEPENDS_SQL,
  PRIVILEGE_AND_MEMBERSHIP_DEPENDS_SQL,
} from "../src/core/depend.ts";
import { EXTENSIONS_SQL } from "../src/core/objects/extension/extension.model.ts";
import { INDEXES_SQL } from "../src/core/objects/index/index.model.ts";
import { TABLES_SQL } from "../src/core/objects/table/table.model.ts";
import { createPool } from "../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type SupabasePostgresVersion,
} from "../tests/constants.ts";
import { SupabasePostgreSqlContainer } from "../tests/supabase-postgres.ts";
import { applySupabaseBaseInit, waitForPool } from "../tests/utils.ts";
import { generateLargeSchemaSql } from "./large-schema-generator.ts";
import { formatMarkdownTable } from "./utils.ts";

const E2E_TABLE_COUNT = Number(
  process.env.BENCH_E2E_TABLE_COUNT ?? process.env.BENCH_TABLE_COUNT ?? "400",
);
if (
  !Number.isInteger(E2E_TABLE_COUNT) ||
  E2E_TABLE_COUNT < 1 ||
  E2E_TABLE_COUNT > 50_000
) {
  console.error(
    `[bench:explain-extract] BENCH_E2E_TABLE_COUNT / BENCH_TABLE_COUNT must be integer 1..50000, got ${String(process.env.BENCH_E2E_TABLE_COUNT ?? process.env.BENCH_TABLE_COUNT ?? "400")}`,
  );
  process.exit(1);
}

interface SqlTagLike {
  text: string;
  values: readonly unknown[];
}

interface Target {
  /** File-safe name (used for output paths). */
  name: string;
  /** Source file the SQL was lifted from. */
  source: string;
  /** Lifted SQL constant. */
  tag: SqlTagLike;
}

const TARGETS: Target[] = [
  {
    name: "depends",
    source: "src/core/depend.ts (DEPENDS_SQL)",
    tag: DEPENDS_SQL as unknown as SqlTagLike,
  },
  {
    name: "privilege-and-membership-depends",
    source: "src/core/depend.ts (PRIVILEGE_AND_MEMBERSHIP_DEPENDS_SQL)",
    tag: PRIVILEGE_AND_MEMBERSHIP_DEPENDS_SQL as unknown as SqlTagLike,
  },
  {
    name: "tables",
    source: "src/core/objects/table/table.model.ts (TABLES_SQL)",
    tag: TABLES_SQL as unknown as SqlTagLike,
  },
  {
    name: "indexes",
    source: "src/core/objects/index/index.model.ts (INDEXES_SQL)",
    tag: INDEXES_SQL as unknown as SqlTagLike,
  },
  {
    name: "extensions",
    source: "src/core/objects/extension/extension.model.ts (EXTENSIONS_SQL)",
    tag: EXTENSIONS_SQL as unknown as SqlTagLike,
  },
];

interface PlanNode {
  "Node Type": string;
  "Actual Total Time"?: number;
  "Actual Loops"?: number;
  "Actual Rows"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
}

interface PlanResult {
  "Planning Time": number;
  "Execution Time": number;
  Plan: PlanNode;
}

function selfTime(node: PlanNode): number {
  const total = node["Actual Total Time"] ?? 0;
  const loops = node["Actual Loops"] ?? 1;
  const own = total * loops;
  const childTime = (node.Plans ?? []).reduce(
    (acc, child) =>
      acc + (child["Actual Total Time"] ?? 0) * (child["Actual Loops"] ?? 1),
    0,
  );
  return Math.max(0, own - childTime);
}

function collectNodes(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of node.Plans ?? []) collectNodes(child, out);
  return out;
}

function totalBuffers(node: PlanNode): { hit: number; read: number } {
  const nodes = collectNodes(node);
  return {
    hit: nodes.reduce((a, n) => a + (n["Shared Hit Blocks"] ?? 0), 0),
    read: nodes.reduce((a, n) => a + (n["Shared Read Blocks"] ?? 0), 0),
  };
}

function topNodesBySelfTime(
  node: PlanNode,
  k: number,
): { type: string; selfMs: number; rows: number }[] {
  return collectNodes(node)
    .map((n) => ({
      type: n["Node Type"],
      selfMs: selfTime(n),
      rows: (n["Actual Rows"] ?? 0) * (n["Actual Loops"] ?? 1),
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, k);
}

async function explain(
  pool: Pool,
  target: Target,
  outDir: string,
): Promise<{
  name: string;
  planningMs: number;
  execMs: number;
  bufHit: number;
  bufRead: number;
  topNodes: ReturnType<typeof topNodesBySelfTime>;
}> {
  // Warm caches.
  await pool.query({ text: target.tag.text, values: [...target.tag.values] });

  const explainPrefix =
    "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT JSON)\n";
  const jsonRes = await pool.query<{ "QUERY PLAN": PlanResult[] }>({
    text: explainPrefix + target.tag.text,
    values: [...target.tag.values],
  });
  const planArray = jsonRes.rows[0]?.["QUERY PLAN"];
  if (!planArray || planArray.length === 0) {
    throw new Error(`EXPLAIN returned no plan for ${target.name}`);
  }
  const plan = planArray[0];
  if (!plan) throw new Error(`EXPLAIN plan empty for ${target.name}`);

  const textPrefix =
    "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT TEXT)\n";
  const textRes = await pool.query<{ "QUERY PLAN": string }>({
    text: textPrefix + target.tag.text,
    values: [...target.tag.values],
  });
  const textPlan = textRes.rows.map((r) => r["QUERY PLAN"]).join("\n");

  await writeFile(
    join(outDir, `${target.name}.json`),
    JSON.stringify(planArray, null, 2),
  );
  const header =
    `-- source: ${target.source}\n` +
    `-- planning ms: ${plan["Planning Time"].toFixed(2)}\n` +
    `-- execution ms: ${plan["Execution Time"].toFixed(2)}\n\n`;
  await writeFile(join(outDir, `${target.name}.txt`), header + textPlan);
  await writeFile(join(outDir, `${target.name}.sql`), target.tag.text);

  const bufs = totalBuffers(plan.Plan);
  return {
    name: target.name,
    planningMs: plan["Planning Time"],
    execMs: plan["Execution Time"],
    bufHit: bufs.hit,
    bufRead: bufs.read,
    topNodes: topNodesBySelfTime(plan.Plan, 5),
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
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
  `[bench:explain-extract] N=${E2E_TABLE_COUNT} tables; targets=${TARGETS.map((t) => t.name).join(", ")}`,
);

type StartedSupabase = Awaited<
  ReturnType<InstanceType<typeof SupabasePostgreSqlContainer>["start"]>
>;

const summaryBlocks: string[] = [];

for (const pgVersion of versions) {
  const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[pgVersion]}`;
  let pool: Pool | undefined;
  let container: StartedSupabase | undefined;
  const outDir = join(
    __dirname,
    "profiles",
    "explain",
    `pg${pgVersion}-N${E2E_TABLE_COUNT}`,
  );
  await mkdir(outDir, { recursive: true });
  try {
    container = await new SupabasePostgreSqlContainer(image).start();
    pool = createPool(container.getConnectionUri(), {
      connectionTimeoutMillis: 30_000,
    });
    await waitForPool(pool);
    await applySupabaseBaseInit(pool, pgVersion);

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
    // Refresh planner stats so EXPLAIN ANALYZE picks reasonable plans.
    await pool.query("ANALYZE");

    const rows: string[][] = [];
    for (const t of TARGETS) {
      console.error(`[bench:explain-extract] explaining ${t.name}…`);
      const r = await explain(pool, t, outDir);
      rows.push([
        r.name,
        r.planningMs.toFixed(2),
        r.execMs.toFixed(2),
        String(r.bufHit),
        String(r.bufRead),
        r.topNodes.map((n) => `${n.type} ${n.selfMs.toFixed(0)}ms`).join("; "),
      ]);
    }

    const block =
      `## pg${pgVersion} (N=${E2E_TABLE_COUNT})\n\n` +
      formatMarkdownTable(
        [
          "extractor",
          "planning ms",
          "exec ms",
          "shared hit",
          "shared read",
          "top nodes (self-time)",
        ],
        rows,
      ) +
      "\n";
    summaryBlocks.push(block);
    console.log(block);
  } catch (e) {
    console.error(`[bench:explain-extract] pg${pgVersion} failed:`, e);
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

if (summaryBlocks.length > 0) {
  const summary =
    `# EXPLAIN ANALYZE summary\n\n` +
    `Generated by \`bench:explain-extract\`. Per-query JSON / text plans live in subdirectories alongside this file.\n\n` +
    summaryBlocks.join("\n");
  await writeFile(
    join(__dirname, "profiles", "explain", "SUMMARY.md"),
    summary,
  );
}
