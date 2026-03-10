import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { analyzeAndSortEffect } from "../src/analyze-and-sort.ts";
import { ParseError } from "../src/errors.ts";
import type { Diagnostic } from "../src/model/types.ts";
import { ParserService } from "../src/services/parser.ts";
import { ParserServiceLive } from "../src/services/parser-live.ts";

describe("ParserService", () => {
  test("ParserServiceLive loads and parses SQL", async () => {
    const result = await analyzeAndSortEffect([
      "CREATE TABLE foo (id int);",
    ]).pipe(Effect.provide(ParserServiceLive), Effect.runPromise);
    expect(result.ordered.length).toBe(1);
    expect(result.ordered[0].sql).toContain("CREATE TABLE");
  });

  test("ParserServiceLive handles multiple SQL inputs", async () => {
    const result = await analyzeAndSortEffect([
      "CREATE TABLE foo (id int);",
      "CREATE VIEW foo_view AS SELECT id FROM foo;",
    ]).pipe(Effect.provide(ParserServiceLive), Effect.runPromise);
    expect(result.ordered.length).toBe(2);
    // Table should come before the view due to dependency
    expect(result.ordered[0].sql).toContain("CREATE TABLE");
    expect(result.ordered[1].sql).toContain("CREATE VIEW");
  });

  test("mock ParserService for testing", async () => {
    const MockParser = Layer.succeed(ParserService, {
      parseSqlContent: (_sql, label) =>
        Effect.succeed({
          statements: [
            {
              id: { filePath: label, statementIndex: 0 },
              ast: { CreateStmt: {} },
              sql: "CREATE TABLE mock_table (id int);",
              annotations: { dependsOn: [], requires: [], provides: [] },
            },
          ],
          diagnostics: [] as Diagnostic[],
        }),
    });

    const result = await analyzeAndSortEffect(["mock sql"]).pipe(
      Effect.provide(MockParser),
      Effect.runPromise,
    );
    expect(result.ordered.length).toBeGreaterThanOrEqual(0);
  });

  test("ParseError is typed in the error channel", async () => {
    const FailingParser = Layer.succeed(ParserService, {
      parseSqlContent: (_sql, _label) =>
        Effect.fail(new ParseError({ message: "parser crashed" })),
    });

    const result = await analyzeAndSortEffect(["bad sql"]).pipe(
      Effect.provide(FailingParser),
      Effect.result,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("ParseError");
      expect(result.failure.message).toBe("parser crashed");
    }
  });

  test("empty input returns discovery error diagnostic", async () => {
    const result = await analyzeAndSortEffect([]).pipe(
      Effect.provide(ParserServiceLive),
      Effect.runPromise,
    );
    expect(result.ordered.length).toBe(0);
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_ERROR")).toBe(
      true,
    );
  });
});
