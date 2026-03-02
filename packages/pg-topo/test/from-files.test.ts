import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { analyzeAndSortFromFiles } from "../src/from-files";
import { createTempFixtureHarness } from "./support/temp-fixture";

describe("analyzeAndSortFromFiles", () => {
  const harness = createTempFixtureHarness("pg-topo-from-files-");

  afterAll(async () => {
    await harness.cleanup();
  });

  test("returns DISCOVERY_ERROR when no roots provided", async () => {
    const result = await analyzeAndSortFromFiles([]);
    expect(result.ordered).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("DISCOVERY_ERROR");
    expect(result.diagnostics[0]?.message).toContain("No roots provided");
    expect(result.graph.nodeCount).toBe(0);
    expect(result.graph.cycleGroups).toEqual([]);
  });

  test("reports DISCOVERY_ERROR for missing root", async () => {
    const result = await analyzeAndSortFromFiles(["/nonexistent/path/12345"]);
    const discoveryErrors = result.diagnostics.filter(
      (d) => d.code === "DISCOVERY_ERROR",
    );
    expect(discoveryErrors.length).toBeGreaterThanOrEqual(1);
    expect(
      discoveryErrors.some((d) => d.message.includes("Root does not exist")),
    ).toBe(true);
  });

  test("single root that is a file uses file directory as base path", async () => {
    const dir = await harness.createSqlFixture({
      "single.sql": "create schema app;",
    });
    const filePath = path.join(dir, "single.sql");
    const result = await analyzeAndSortFromFiles([filePath]);
    expect(
      result.diagnostics.filter((d) => d.code === "DISCOVERY_ERROR"),
    ).toHaveLength(0);
    expect(result.ordered.length).toBe(1);
    expect(result.ordered[0]?.id.filePath).toBe("single.sql");
  });

  test("multiple roots compute common base and return stable paths", async () => {
    const dir = await harness.createSqlFixture({
      "a/schema.sql": "create schema a;",
      "b/schema.sql": "create schema b;",
    });
    const rootA = path.join(dir, "a");
    const rootB = path.join(dir, "b");
    const result = await analyzeAndSortFromFiles([rootA, rootB]);
    expect(
      result.diagnostics.filter((d) => d.code === "DISCOVERY_ERROR"),
    ).toHaveLength(0);
    expect(result.ordered.length).toBe(2);
    const paths = result.ordered.map((n) => n.id.filePath).sort();
    expect(paths).toContain("a/schema.sql");
    expect(paths).toContain("b/schema.sql");
  });

  test("cycle in from-files remaps cycleGroups to stable file paths", async () => {
    const dir = await harness.createSqlFixture({
      "v1.sql": "create view public.v1 as select * from public.v2;",
      "v2.sql": "create view public.v2 as select * from public.v1;",
    });
    const result = await analyzeAndSortFromFiles([dir]);
    expect(result.graph.cycleGroups.length).toBeGreaterThan(0);
    for (const group of result.graph.cycleGroups) {
      for (const statementId of group) {
        expect(statementId.filePath).not.toMatch(/^<input:\d+>$/);
        expect(statementId.filePath).toMatch(/\.sql$/);
      }
    }
    const cycleDiag = result.diagnostics.find(
      (d) => d.code === "CYCLE_DETECTED",
    );
    expect(cycleDiag).toBeDefined();
    expect(cycleDiag?.statementId?.filePath).not.toMatch(/^<input:\d+>$/);
  });
});
