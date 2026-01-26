import type { Pool } from "pg";
import { test as baseTest } from "vitest";
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

/**
 * Default test utility using Alpine PostgreSQL containers with single container per version.
 * Uses CREATE/DROP DATABASE for isolation instead of creating new containers.
 * Fast and suitable for most tests.
 */
export function getTest(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { main: Pool; branch: Pool };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const { main, branch, cleanup } =
        await containerManager.getDatabasePair(postgresVersion);

      await use({ main, branch });

      await cleanup();
    },
  });
}

/**
 * Isolated test utility using Alpine PostgreSQL containers.
 * Creates fresh containers for each test, then removes them.
 * Slower but provides complete isolation.
 */
export function getTestIsolated(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { main: Pool; branch: Pool };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const { main, branch, cleanup } =
        await containerManager.getIsolatedContainers(postgresVersion);

      await use({ main, branch });

      await cleanup();
    },
  });
}

/**
 * Test utility using Supabase PostgreSQL containers with full isolation.
 * Same behavior as the original getTest function.
 * Use for tests that require Supabase-specific features.
 */
export function getTestWithSupabaseIsolated(postgresVersion: PostgresVersion) {
  return baseTest.extend<{
    db: { main: Pool; branch: Pool };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`;
      const [containerMain, containerBranch] = await Promise.all([
        new SupabasePostgreSqlContainer(image).start(),
        new SupabasePostgreSqlContainer(image).start(),
      ]);
      const main = createPool(containerMain.getConnectionUri(), {
        onError: suppressShutdownError,
      });
      const branch = createPool(containerBranch.getConnectionUri(), {
        onError: suppressShutdownError,
      });

      await use({ main, branch });

      await Promise.all([main.end(), branch.end()]);
      await Promise.all([containerMain.stop(), containerBranch.stop()]);
    },
  });
}
