import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { CatalogExtractionError, DeclarativeApplyError } from "../errors.ts";
import type { DatabaseApi } from "../services/database.ts";
import { DatabaseResolver } from "../services/database-resolver.ts";
import { withResolvedDatabase } from "./index.ts";

describe("withResolvedDatabase", () => {
  test("caller-provided database is used directly", async () => {
    const database = createMockDatabase();
    const resolver = mock((_url: string) =>
      Effect.die(new Error("should not create scoped database")),
    );

    await expect(
      withResolvedDatabase(
        {
          content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
          pool: database,
        },
        () =>
          Effect.fail(
            new CatalogExtractionError({
              message: "simulated catalog extraction failure",
            }),
          ),
      ).pipe(
        Effect.provideService(DatabaseResolver, {
          fromConnectionString: resolver,
        }),
        Effect.runPromise,
      ),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(resolver).not.toHaveBeenCalled();
  });

  test("internally-resolved database is released on early failure", async () => {
    let lastScopedDbClosed = false;
    const resolver = mock((_url: string) =>
      Effect.acquireRelease(Effect.succeed(createMockDatabase()), () =>
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
      ).pipe(
        Effect.provideService(DatabaseResolver, {
          fromConnectionString: resolver,
        }),
        Effect.runPromise,
      ),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(resolver).toHaveBeenCalledTimes(1);
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
