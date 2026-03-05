import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { discoverSqlFiles } from "../src/ingest/discover.ts";
import { parseSqlContent } from "../src/ingest/parse.ts";
import { createTempFixtureHarness } from "./support/temp-fixture";

describe("discoverSqlFiles", () => {
  const harness = createTempFixtureHarness("pg-topo-ingest-");

  afterAll(async () => {
    await harness.cleanup();
  });

  test("empty roots returns empty files and missingRoots", async () => {
    const result = await discoverSqlFiles([]);
    expect(result.files).toEqual([]);
    expect(result.missingRoots).toEqual([]);
  });

  test("missing root is reported in missingRoots", async () => {
    const result = await discoverSqlFiles(["/nonexistent/path/12345"]);
    expect(result.files).toEqual([]);
    expect(result.missingRoots).toHaveLength(1);
    expect(result.missingRoots[0]).toContain("nonexistent");
  });

  test("single .sql file root returns that file", async () => {
    const dir = await harness.createSqlFixture({
      "only.sql": "create schema app;",
    });
    const filePath = path.join(dir, "only.sql");
    const result = await discoverSqlFiles([filePath]);
    expect(result.missingRoots).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBe(path.resolve(filePath));
  });

  test("directory root discovers .sql files recursively", async () => {
    const dir = await harness.createSqlFixture({
      "nested/schema.sql": "create schema nested;",
      "top.sql": "create schema top;",
    });
    const result = await discoverSqlFiles([dir]);
    expect(result.missingRoots).toEqual([]);
    expect(result.files.length).toBeGreaterThanOrEqual(2);
    expect(result.files.some((f) => f.endsWith("top.sql"))).toBe(true);
    expect(result.files.some((f) => f.endsWith("schema.sql"))).toBe(true);
  });

  test("mixed roots: missing and valid directory returns files and missingRoots", async () => {
    const dir = await harness.createSqlFixture({
      "a.sql": "create schema a;",
    });
    const result = await discoverSqlFiles([
      "/nonexistent/missing/root",
      dir,
    ]);
    expect(result.missingRoots).toHaveLength(1);
    expect(result.missingRoots[0]).toContain("nonexistent");
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.files.some((f) => f.endsWith("a.sql"))).toBe(true);
  });
});

describe("parseSqlContent", () => {
  test("empty content returns empty statements", async () => {
    const result = await parseSqlContent("", "empty.sql");
    expect(result.statements).toHaveLength(0);
  });

  test("whitespace-only content returns empty statements", async () => {
    const result = await parseSqlContent("   \n\t  ", "ws.sql");
    expect(result.statements).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});
