import type { Pool } from "pg";
import { createPool } from "../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
} from "./constants.ts";
import { containerManager } from "./container-manager.js";
import { SupabasePostgreSqlContainer } from "./supabase-postgres.js";

/**
 * Suppress expected shutdown errors from idle pool connections.
 * Error code 57P01 = admin_shutdown (container stopped while connection open)
 */
function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01") return;
  console.error("Pool error:", err);
}

export type DbFixture = { main: Pool; branch: Pool };

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
  postgresVersion: PostgresVersion,
  fn: (db: DbFixture) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`;
    const [containerMain, containerBranch] = await Promise.all([
      new SupabasePostgreSqlContainer(image).start(),
      new SupabasePostgreSqlContainer(image).start(),
    ]);
    const main = createPool(containerMain.getConnectionUri(), {
      max: 5,
      onError: suppressShutdownError,
    });
    const branch = createPool(containerBranch.getConnectionUri(), {
      max: 5,
      onError: suppressShutdownError,
    });

    try {
      await fn({ main, branch });
    } finally {
      await Promise.all([main.end(), branch.end()]);
      await Promise.all([containerMain.stop(), containerBranch.stop()]);
    }
  };
}
