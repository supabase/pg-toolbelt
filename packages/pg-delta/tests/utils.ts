import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { createPool } from "../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
  type SupabasePostgresVersion,
} from "./constants.ts";
import { containerManager } from "./container-manager.js";
import { SupabasePostgreSqlContainer } from "./supabase-postgres.js";

/**
 * Suppress expected errors from idle pool connections.
 * 57P01 = admin_shutdown (container stopped while connection open)
 * 53100 = disk_full (container out of disk under heavy concurrent tests)
 */
function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") return;
  console.error("Pool error:", err);
}

export type DbFixture = { main: Pool; branch: Pool };

// The generated base-init fixtures are large and shared by many Supabase tests.
// Cache the file-read promise per major version so concurrent tests do not keep
// re-reading the same SQL blob from disk.
const supabaseBaseInitSqlCache = new Map<
  SupabasePostgresVersion,
  Promise<string>
>();

// Keep fixture path resolution in one place so the sync script output location
// and the runtime lookup stay tightly coupled.
function getSupabaseBaseInitFixturePath(
  postgresVersion: SupabasePostgresVersion,
): string {
  return join(
    import.meta.dir,
    "integration",
    "fixtures",
    "supabase-base-init",
    `${postgresVersion}_fullstack_container_init.sql`,
  );
}

// Load the committed replay SQL produced by `bun run sync-base-images`. Tests
// fail fast here if the fixture is missing so the problem is obvious during
// bootstrap instead of surfacing later as missing Supabase schemas/tables.
async function getSupabaseBaseInitSql(
  postgresVersion: SupabasePostgresVersion,
): Promise<string> {
  const cached = supabaseBaseInitSqlCache.get(postgresVersion);
  if (cached) {
    return cached;
  }

  const sqlPromise = readFile(
    getSupabaseBaseInitFixturePath(postgresVersion),
    "utf-8",
  ).catch((error) => {
    throw new Error(
      `Missing Supabase base init fixture for pg${postgresVersion}. Run \`bun run sync-base-images\` in packages/pg-delta first.`,
      { cause: error },
    );
  });

  supabaseBaseInitSqlCache.set(postgresVersion, sqlPromise);
  return sqlPromise;
}

// Replay the generated "full stack minus bare image" delta into one database.
// After this runs, a plain `supabase/postgres` test container should look like
// a DB that has already been bootstrapped by the rest of the local Supabase
// stack for the same image version.
export async function applySupabaseBaseInit(
  pool: Pool,
  postgresVersion: SupabasePostgresVersion,
): Promise<void> {
  const sql = await getSupabaseBaseInitSql(postgresVersion);
  await pool.query(sql);
}

// Most diff-style tests need both sides of the fixture to start from the same
// Supabase-managed baseline before the test-specific SQL makes `main` and
// `branch` diverge.
export async function applySupabaseBaseInitToFixture(
  db: DbFixture,
  postgresVersion: SupabasePostgresVersion,
): Promise<void> {
  await Promise.all([
    applySupabaseBaseInit(db.main, postgresVersion),
    applySupabaseBaseInit(db.branch, postgresVersion),
  ]);
}

/**
 * Retry pool.connect() until the database is truly accepting connections.
 * Supabase containers may pass their Docker health check before init scripts
 * finish, and concurrent container startup adds resource pressure.
 */
export async function waitForPool(
  pool: Pool,
  retries = 5,
  delayMs = 2000,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch {
      if (i === retries - 1)
        throw new Error(`Pool not ready after ${retries} attempts`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Default test utility using Alpine PostgreSQL containers with single container per version.
 * Uses CREATE/DROP DATABASE for isolation instead of creating new containers.
 * Fast and suitable for most tests.
 *
 * Usage: test("name", withDb(pgVersion, async (db) => { ... }));
 */
export function withDb(
  postgresVersion: PostgresVersion,
  fn: (db: DbFixture) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const { main, branch, cleanup } =
      await containerManager.getDatabasePair(postgresVersion);
    try {
      await fn({ main, branch });
    } finally {
      await cleanup();
    }
  };
}

/**
 * Isolated test utility using Alpine PostgreSQL containers.
 * Creates fresh containers for each test, then removes them.
 * Slower but provides complete isolation.
 *
 * Usage: test("name", withDbIsolated(pgVersion, async (db) => { ... }));
 */
export function withDbIsolated(
  postgresVersion: PostgresVersion,
  fn: (db: DbFixture) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const { main, branch, cleanup } =
      await containerManager.getIsolatedContainers(postgresVersion);
    try {
      await fn({ main, branch });
    } finally {
      await cleanup();
    }
  };
}

/**
 * Test utility using Supabase PostgreSQL containers with full isolation.
 * Use for tests that require Supabase-specific features.
 *
 * Usage: test("name", withDbSupabaseIsolated(pgVersion, async (db) => { ... }));
 */
export function withDbSupabaseIsolated(
  postgresVersion: SupabasePostgresVersion,
  fn: (db: DbFixture) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`;
    const [containerMain, containerBranch] = await Promise.all([
      new SupabasePostgreSqlContainer(image).start(),
      new SupabasePostgreSqlContainer(image).start(),
    ]);
    const main = createPool(containerMain.getConnectionUri(), {
      onError: suppressShutdownError,
      connectionTimeoutMillis: 20_000,
    });
    const branch = createPool(containerBranch.getConnectionUri(), {
      onError: suppressShutdownError,
      connectionTimeoutMillis: 20_000,
    });

    await Promise.all([waitForPool(main), waitForPool(branch)]);

    try {
      // The raw image is no longer the intended Supabase test baseline. Before
      // running test code, replay the generated base-init SQL onto both
      // databases so service-owned objects such as `auth`, `storage`, and
      // `realtime` match what `supabase start` would have initialized.
      await applySupabaseBaseInitToFixture({ main, branch }, postgresVersion);
      await fn({ main, branch });
    } finally {
      await Promise.all([main.end(), branch.end()]);
      await Promise.all([containerMain.stop(), containerBranch.stop()]);
    }
  };
}
