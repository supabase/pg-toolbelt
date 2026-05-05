/**
 * Long-running benchmark database. Boots a Supabase Postgres container,
 * applies base-init + the synthetic large-schema generator, prints the
 * connection URL to stdout, then sleeps until killed.
 *
 * Use with `bench:quick-extract`:
 *
 *   # Terminal A (keep running):
 *   PGDELTA_TEST_POSTGRES_VERSIONS=17 BENCH_E2E_TABLE_COUNT=400 \
 *     bun bench/serve-db.ts > /tmp/bench-db.log 2>&1 &
 *   # Wait for "READY url=..." line in the log, then:
 *   export BENCH_DB_URL="$(grep '^READY url=' /tmp/bench-db.log | sed 's/READY url=//')"
 *
 *   # Terminal B (fast iteration):
 *   bun bench/quick-extract.ts          # ~3-10s/run
 *
 * Kill with `pkill -f bench/serve-db.ts` when finished.
 */

import { createPool } from "../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type SupabasePostgresVersion,
} from "../tests/constants.ts";
import { SupabasePostgreSqlContainer } from "../tests/supabase-postgres.ts";
import { applySupabaseBaseInit, waitForPool } from "../tests/utils.ts";
import { generateLargeSchemaSql } from "./large-schema-generator.ts";

const E2E_TABLE_COUNT = Number(
  process.env.BENCH_E2E_TABLE_COUNT ?? process.env.BENCH_TABLE_COUNT ?? "400",
);

const versionsRaw = process.env.PGDELTA_TEST_POSTGRES_VERSIONS?.split(",") ?? [
  "17",
];
const versions = versionsRaw
  .map((v) => Number(v) as SupabasePostgresVersion)
  .filter((v) => v in POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG);

if (versions.length === 0) {
  console.error("No valid versions in PGDELTA_TEST_POSTGRES_VERSIONS");
  process.exit(1);
}

const pgVersion = versions[0];
if (pgVersion === undefined) {
  process.exit(1);
}
const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[pgVersion]}`;
console.error(`[serve-db] starting ${image}, N=${E2E_TABLE_COUNT}…`);

const container = await new SupabasePostgreSqlContainer(image).start();
const uri = container.getConnectionUri();
const pool = createPool(uri, { connectionTimeoutMillis: 30_000 });

try {
  await waitForPool(pool);
  console.error("[serve-db] applying base-init…");
  await applySupabaseBaseInit(pool, pgVersion);

  console.error(`[serve-db] applying synthetic schema (N=${E2E_TABLE_COUNT})…`);
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
  if (process.env.BENCH_SKIP_ANALYZE !== "1") {
    console.error("[serve-db] running ANALYZE…");
    await pool.query("ANALYZE");
  } else {
    console.error("[serve-db] BENCH_SKIP_ANALYZE=1, skipping ANALYZE");
  }
} finally {
  await pool.end().catch(() => {});
}

console.log(`READY url=${uri} pg=${pgVersion} tables=${E2E_TABLE_COUNT}`);
console.error(
  `[serve-db] ready. PID=${process.pid}. Kill with 'kill ${process.pid}' or pkill -f bench/serve-db.ts`,
);

process.on("SIGINT", async () => {
  console.error("[serve-db] SIGINT, stopping container…");
  await container.stop().catch(() => {});
  process.exit(0);
});
process.on("SIGTERM", async () => {
  console.error("[serve-db] SIGTERM, stopping container…");
  await container.stop().catch(() => {});
  process.exit(0);
});

// Keep alive forever
await new Promise(() => {});
