import { describe, expect, test } from "bun:test";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { analyzeAndSortFromFilesEffect } from "../src/from-files.ts";
import { ParserServiceLive } from "../src/services/parser-live.ts";

const TestLayer = Layer.merge(ParserServiceLive, BunFileSystem.layer);

describe("analyzeAndSortFromFilesEffect", () => {
  test("works with BunFileSystem layer on real fixtures", async () => {
    const result = await analyzeAndSortFromFilesEffect([
      "./test/fixtures/diverse-schema",
    ]).pipe(Effect.provide(TestLayer), Effect.runPromise);
    expect(result.ordered.length).toBeGreaterThan(0);
  });

  test("reports missing roots", async () => {
    const result = await analyzeAndSortFromFilesEffect([
      "/nonexistent/path/does/not/exist",
    ]).pipe(Effect.provide(TestLayer), Effect.runPromise);
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_ERROR")).toBe(
      true,
    );
  });

  test("empty roots returns discovery error", async () => {
    const result = await analyzeAndSortFromFilesEffect([]).pipe(
      Effect.provide(TestLayer),
      Effect.runPromise,
    );
    expect(result.ordered.length).toBe(0);
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_ERROR")).toBe(
      true,
    );
  });
});
