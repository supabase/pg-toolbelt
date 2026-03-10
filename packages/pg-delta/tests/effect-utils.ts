import { Effect } from "effect";
import type { Pool } from "pg";
import type { DatabaseApi } from "../src/core/services/database.ts";
import { wrapPool } from "../src/core/services/database-live.ts";
import type { PostgresVersion } from "./constants.ts";
import { containerManager } from "./container-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestDb {
  readonly main: DatabaseApi;
  readonly branch: DatabaseApi;
  readonly mainPool: Pool;
  readonly branchPool: Pool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Effect-based version of withDb.
 *
 * Usage:
 * ```typescript
 * test("name", withDbEffect(pgVersion, (db) =>
 *   Effect.gen(function* () {
 *     yield* db.branch.query("CREATE TABLE ...");
 *     // ...
 *   }),
 * ));
 * ```
 */
export function withDbEffect(
  postgresVersion: PostgresVersion,
  fn: (db: TestDb) => Effect.Effect<void, unknown>,
): () => Promise<void> {
  return async () => {
    const { main, branch, cleanup } =
      await containerManager.getDatabasePair(postgresVersion);
    try {
      const testDb: TestDb = {
        main: wrapPool(main),
        branch: wrapPool(branch),
        mainPool: main,
        branchPool: branch,
      };
      await fn(testDb).pipe(Effect.runPromise);
    } finally {
      await cleanup();
    }
  };
}

/**
 * Effect-based version of withDbIsolated.
 */
export function withDbIsolatedEffect(
  postgresVersion: PostgresVersion,
  fn: (db: TestDb) => Effect.Effect<void, unknown>,
): () => Promise<void> {
  return async () => {
    const { main, branch, cleanup } =
      await containerManager.getIsolatedContainers(postgresVersion);
    try {
      const testDb: TestDb = {
        main: wrapPool(main),
        branch: wrapPool(branch),
        mainPool: main,
        branchPool: branch,
      };
      await fn(testDb).pipe(Effect.runPromise);
    } finally {
      await cleanup();
    }
  };
}
