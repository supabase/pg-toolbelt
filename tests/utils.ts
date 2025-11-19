import postgres from "postgres";
import { test as baseTest } from "vitest";
import { postgresConfig } from "../src/main.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
} from "./constants.ts";
import { containerManager } from "./container-manager.js";
import { getPgliteTest } from "./pglite-utils.ts";
import { SupabasePostgreSqlContainer } from "./supabase-postgres.js";

/**
 * Default test utility using PGlite (in-memory WASM Postgres).
 * Super fast, no Docker needed! Uses in-memory databases for each test.
 * Perfect for most tests and CI/CD.
 *
 * To use Docker containers instead, set USE_DOCKER=true environment variable.
 */
export function getTest(postgresVersion: PostgresVersion) {
  // Use PGlite by default for speed, unless USE_DOCKER is set
  if (!process.env.USE_DOCKER) {
    return getPgliteTest();
  }

  // Fall back to Docker containers if explicitly requested
  return baseTest.extend<{
    db: { main: postgres.Sql; branch: postgres.Sql };
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
 * Isolated test utility.
 * By default uses PGlite (each test gets fresh in-memory instances).
 * Set USE_DOCKER=true to use Docker containers instead.
 */
export function getTestIsolated(postgresVersion: PostgresVersion) {
  // PGlite is always isolated (fresh instances per test), so just use the regular test
  if (!process.env.USE_DOCKER) {
    return getPgliteTest();
  }

  // Docker version: creates fresh containers for each test
  return baseTest.extend<{
    db: { main: postgres.Sql; branch: postgres.Sql };
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
    db: { main: postgres.Sql; branch: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`;
      const [containerMain, containerBranch] = await Promise.all([
        new SupabasePostgreSqlContainer(image).start(),
        new SupabasePostgreSqlContainer(image).start(),
      ]);
      const main = postgres(containerMain.getConnectionUri(), postgresConfig);
      const branch = postgres(
        containerBranch.getConnectionUri(),
        postgresConfig,
      );

      await use({ main, branch });

      await Promise.all([main.end(), branch.end()]);
      await Promise.all([containerMain.stop(), containerBranch.stop()]);
    },
  });
}
