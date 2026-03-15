import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type { Pool } from "pg";
import { CatalogExtractionError, DeclarativeApplyError } from "../errors.ts";
import type { DatabaseApi } from "../services/database.ts";
import { withResolvedDatabase } from "./index.ts";

describe("withResolvedDatabase", () => {
  test("caller-owned pool is NOT closed on early failure", async () => {
    const pool = createMockPool();
    const wrapPool = mock((_pool: Pool) => createMockDatabase());
    const makeScopedPool = mock((_url: string) =>
      Effect.die(new Error("should not create scoped database")),
    );

    await expect(
      withResolvedDatabase(
        {
          content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
          pool,
        },
        () =>
          Effect.fail(
            new CatalogExtractionError({
              message: "simulated catalog extraction failure",
            }),
          ),
        {
          wrapPool,
          makeScopedPool,
        },
      ).pipe(Effect.runPromise),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(wrapPool).toHaveBeenCalledTimes(1);
    expect(wrapPool).toHaveBeenCalledWith(pool);
    expect(makeScopedPool).not.toHaveBeenCalled();
    expect(pool.closeCalled).toBe(false);
  });

  test("internally-created pool IS closed on early failure", async () => {
    let lastScopedDbClosed = false;
    const makeScopedPool = mock((_url: string) =>
      Effect.acquireRelease(
        Effect.succeed(createMockDatabase()),
        () =>
          Effect.sync(() => {
            lastScopedDbClosed = true;
          }),
      ),
    );

    await expect(
      withResolvedDatabase(
        {
          content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
          targetUrl: "postgresql://localhost/test",
        },
        () =>
          Effect.fail(
            new CatalogExtractionError({
              message: "simulated catalog extraction failure",
            }),
          ),
        {
          wrapPool: (_pool: Pool) => {
            throw new Error("should not wrap caller-owned pool");
          },
          makeScopedPool,
        },
      ).pipe(Effect.runPromise),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(makeScopedPool).toHaveBeenCalledTimes(1);
    expect(lastScopedDbClosed).toBe(true);
  });

  test("requires either a target url or pool", async () => {
    const result = await withResolvedDatabase(
      { content: [{ filePath: "test.sql", sql: "SELECT 1" }] },
      () => Effect.succeed(undefined),
    ).pipe(Effect.result, Effect.runPromise);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(DeclarativeApplyError);
      expect(result.failure.message).toBe(
        "Either targetUrl or pool must be provided",
      );
    }
  });
});

function createMockDatabase(): DatabaseApi {
  return {
    query: () => Effect.die(new Error("should not query mock")),
    withConnection: () => {
      throw new Error("should not call withConnection on mock");
    },
  } as unknown as DatabaseApi;
}

function createMockPool(): Pool & { closeCalled: boolean } {
  const pool = {
    closeCalled: false,
    connect: async () => {
      throw new Error("should not connect");
    },
    end: async function end() {
      pool.closeCalled = true;
    },
    query: async () => {
      throw new Error("should not query");
    },
  } as unknown as Pool & { closeCalled: boolean };

  return pool;
}
