import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Effect, FileSystem, Layer } from "effect";
import { analyzeAndSortFromFiles } from "../src/from-files.ts";
import { ParserServiceLive } from "../src/services/parser-live.ts";
import { WorkingDirectory } from "../src/services/working-directory.ts";

const TestFileSystem = Layer.succeed(FileSystem.FileSystem, {
  exists: (filePath: string) =>
    Effect.promise(async () => {
      try {
        await stat(filePath);
        return true;
      } catch {
        return false;
      }
    }),
  stat: (filePath: string) =>
    Effect.promise(async () => {
      try {
        const info = await stat(filePath);
        return info.isDirectory()
          ? ({ type: "Directory" } as const)
          : ({ type: "File" } as const);
      } catch {
        return { type: "Directory" } as const;
      }
    }),
  readDirectory: (directoryPath: string) =>
    Effect.promise(() => readdir(directoryPath)),
  readFileString: (filePath: string, _encoding: string) =>
    Effect.promise(() => readFile(filePath, "utf-8")),
} as never);

const TestLayer = Layer.mergeAll(
  ParserServiceLive,
  TestFileSystem,
  Layer.succeed(WorkingDirectory, { cwd: process.cwd() }),
);

describe("analyzeAndSortFromFiles", () => {
  test("works with a FileSystem layer on real fixtures", async () => {
    const result = await analyzeAndSortFromFiles([
      "./test/fixtures/diverse-schema",
    ]).pipe(Effect.provide(TestLayer), Effect.runPromise);
    expect(result.ordered.length).toBeGreaterThan(0);
  });

  test("reports missing roots", async () => {
    const result = await analyzeAndSortFromFiles([
      "/nonexistent/path/does/not/exist",
    ]).pipe(Effect.provide(TestLayer), Effect.runPromise);
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_ERROR")).toBe(
      true,
    );
  });

  test("empty roots returns discovery error", async () => {
    const result = await analyzeAndSortFromFiles([]).pipe(
      Effect.provide(TestLayer),
      Effect.runPromise,
    );
    expect(result.ordered.length).toBe(0);
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_ERROR")).toBe(
      true,
    );
  });

  test("resolves relative roots against injected working directory", async () => {
    const result = await analyzeAndSortFromFiles([
      "fixtures/diverse-schema",
    ]).pipe(
      Effect.provide(
        Layer.mergeAll(
          ParserServiceLive,
          TestFileSystem,
          Layer.succeed(WorkingDirectory, {
            cwd: path.join(process.cwd(), "test"),
          }),
        ),
      ),
      Effect.runPromise,
    );

    expect(result.ordered.length).toBeGreaterThan(0);
  });
});
