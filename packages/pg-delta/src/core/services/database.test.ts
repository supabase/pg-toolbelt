import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { CatalogExtractionError } from "../errors.ts";
import type { DatabaseApi } from "./database.ts";

describe("DatabaseApi mock", () => {
  test("can mock query responses", async () => {
    const MockDb: DatabaseApi = {
      query: (_sql) => Effect.succeed({ rows: [{ count: 42 }], rowCount: 1 }),
      getPool: () => {
        throw new Error("no pool in mock");
      },
    };

    const result = await MockDb.query<{ count: number }>("SELECT 42").pipe(
      Effect.runPromise,
    );
    expect(result.rows[0].count).toBe(42);
  });

  test("query failure produces CatalogExtractionError", async () => {
    const FailingDb: DatabaseApi = {
      query: () =>
        Effect.fail(new CatalogExtractionError({ message: "boom" })),
      getPool: () => {
        throw new Error("no pool");
      },
    };

    const result = await FailingDb.query("SELECT 1").pipe(
      Effect.either,
      Effect.runPromise,
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("CatalogExtractionError");
      expect(result.left.message).toBe("boom");
    }
  });

  test("mock with parameterized queries", async () => {
    const MockDb: DatabaseApi = {
      query: (_sql, values) =>
        Effect.succeed({
          rows: [{ id: values?.[0] ?? 1 }],
          rowCount: 1,
        }),
      getPool: () => {
        throw new Error("no pool in mock");
      },
    };

    const result = await MockDb.query<{ id: number }>("SELECT $1", [
      99,
    ]).pipe(Effect.runPromise);
    expect(result.rows[0].id).toBe(99);
  });
});
