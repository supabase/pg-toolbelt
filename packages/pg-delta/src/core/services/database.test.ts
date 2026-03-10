import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { CatalogExtractionError } from "../errors.ts";
import type { DatabaseApi } from "./database.ts";

describe("DatabaseApi mock", () => {
  test("can mock query responses", async () => {
    const MockDb = {
      query: (_sql: string) =>
        Effect.succeed({ rows: [{ count: 42 }], rowCount: 1 }),
      getPool: () => {
        throw new Error("no pool in mock");
      },
    } as unknown as DatabaseApi;

    const result = await MockDb.query<{ count: number }>("SELECT 42").pipe(
      Effect.runPromise,
    );
    expect(result.rows[0].count).toBe(42);
  });

  test("query failure produces CatalogExtractionError", async () => {
    const FailingDb = {
      query: () => Effect.fail(new CatalogExtractionError({ message: "boom" })),
      getPool: () => {
        throw new Error("no pool");
      },
    } as unknown as DatabaseApi;

    const result = await Effect.runPromise(
      Effect.result(FailingDb.query("SELECT 1")),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CatalogExtractionError");
      expect(result.failure.message).toBe("boom");
    }
  });

  test("mock with parameterized queries", async () => {
    const MockDb = {
      query: (_sql: string, values?: unknown[]) =>
        Effect.succeed({
          rows: [{ id: values?.[0] ?? 1 }],
          rowCount: 1,
        }),
      getPool: () => {
        throw new Error("no pool in mock");
      },
    } as unknown as DatabaseApi;

    const result = await MockDb.query<{ id: number }>("SELECT $1", [99]).pipe(
      Effect.runPromise,
    );
    expect(result.rows[0].id).toBe(99);
  });
});
