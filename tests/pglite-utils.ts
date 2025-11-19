import { PGlite } from "@electric-sql/pglite";
import type postgres from "postgres";
import { test as baseTest } from "vitest";
import { createPgliteAdapter } from "../src/adapter.ts";

/**
 * Create a postgres.Sql-compatible wrapper around PGlite
 * This allows PGlite to be used as a drop-in replacement in tests
 */
function createPostgresCompatiblePglite(pg: PGlite): postgres.Sql {
  const adapter = createPgliteAdapter(pg);

  // Create a postgres.Sql-like interface
  const wrapper = Object.assign(adapter, {
    unsafe: async (query: string): Promise<void> => {
      await pg.exec(query);
    },
    exec: async (query: string): Promise<void> => {
      await pg.exec(query);
    },
    end: async (): Promise<void> => {
      await pg.close();
    },
  });

  return wrapper as unknown as postgres.Sql;
}

/**
 * PGlite-based test utility - super fast, no Docker needed!
 * Creates in-memory PGlite instances for each test.
 */
export function getPgliteTest() {
  return baseTest.extend<{
    db: { main: postgres.Sql; branch: postgres.Sql };
  }>({
    // biome-ignore lint/correctness/noEmptyPattern: The first argument inside a fixture must use object destructuring pattern
    db: async ({}, use) => {
      // Create two in-memory PGlite instances
      const mainPg = await PGlite.create();
      const branchPg = await PGlite.create();

      // Wrap them with postgres.Sql-compatible interface
      const main = createPostgresCompatiblePglite(mainPg);
      const branch = createPostgresCompatiblePglite(branchPg);

      await use({ main, branch });

      // Clean up
      await mainPg.close();
      await branchPg.close();
    },
  });
}

/**
 * Get PGlite test for a specific postgres version (for compatibility)
 * Note: PGlite doesn't have different versions, so this ignores the version parameter
 */
export function getPgliteTestForVersion(_version: number) {
  return getPgliteTest();
}
