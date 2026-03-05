import { describe, expect, test } from "bun:test";
import {
  COVERAGE_IGNORE,
  fixLcovContent,
  globToRegex,
  packageForArtifact,
  shouldStripPath,
  stripLcovRecords,
} from "./fix-lcov-paths.ts";

function lcovRecord(sfPath: string): string {
  return [
    `SF:${sfPath}`,
    "FN:1,myFunc",
    "FNDA:5,myFunc",
    "FNF:1",
    "FNH:1",
    "DA:1,5",
    "DA:2,3",
    "LF:2",
    "LH:2",
    "end_of_record",
  ].join("\n");
}

describe("packageForArtifact", () => {
  test("maps pg-delta unit coverage", () => {
    expect(packageForArtifact("coverage-pg-delta-unit")).toBe("pg-delta");
  });
  test("maps pg-delta integration shards", () => {
    expect(packageForArtifact("coverage-integration-pg15-shard-1")).toBe(
      "pg-delta",
    );
    expect(packageForArtifact("coverage-integration-pg17-shard-12")).toBe(
      "pg-delta",
    );
  });
  test("maps pg-topo", () => {
    expect(packageForArtifact("coverage-pg-topo")).toBe("pg-topo");
  });
  test("returns null for non-package artifacts", () => {
    expect(packageForArtifact("coverage-merged")).toBeNull();
    expect(packageForArtifact("coverage-html")).toBeNull();
    expect(packageForArtifact("something-else")).toBeNull();
  });
});

describe("globToRegex", () => {
  test("literal path", () => {
    const re = globToRegex("tests/constants.ts");
    expect(re.test("tests/constants.ts")).toBe(true);
    expect(re.test("tests/constants.tsx")).toBe(false);
    expect(re.test("src/tests/constants.ts")).toBe(false);
  });

  test("** matches any depth", () => {
    const re = globToRegex("**/changes/*.base.ts");
    expect(re.test("src/core/objects/table/changes/table.base.ts")).toBe(true);
    expect(re.test("changes/foo.base.ts")).toBe(true);
    expect(re.test("src/changes/nested/foo.base.ts")).toBe(false);
  });

  test("* matches single segment", () => {
    const re = globToRegex("tests/*.ts");
    expect(re.test("tests/utils.ts")).toBe(true);
    expect(re.test("tests/deep/utils.ts")).toBe(false);
  });

  test("escapes regex special chars in path", () => {
    const re = globToRegex("src/file.test.ts");
    expect(re.test("src/file.test.ts")).toBe(true);
    expect(re.test("src/fileXtest.ts")).toBe(false);
  });
});

describe("shouldStripPath", () => {
  test("strips cross-package paths (../ prefix)", () => {
    expect(shouldStripPath("../pg-topo/src/index.ts", "pg-delta")).toBe(true);
    expect(
      shouldStripPath("../pg-topo/src/analyze-and-sort.ts", "pg-delta"),
    ).toBe(true);
    expect(shouldStripPath("../other-pkg/foo.ts", "pg-delta")).toBe(true);
  });

  test("strips test files when skipTestFiles is true", () => {
    expect(shouldStripPath("src/core/catalog.diff.test.ts", "pg-delta")).toBe(
      true,
    );
    expect(
      shouldStripPath("tests/integration/roundtrip.test.ts", "pg-delta"),
    ).toBe(true);
    expect(shouldStripPath("test/topo-sort.test.ts", "pg-topo")).toBe(true);
  });

  test("keeps source files", () => {
    expect(shouldStripPath("src/core/catalog.diff.ts", "pg-delta")).toBe(false);
    expect(shouldStripPath("src/index.ts", "pg-topo")).toBe(false);
  });

  test("strips pg-delta infrastructure patterns", () => {
    expect(shouldStripPath("tests/constants.ts", "pg-delta")).toBe(true);
    expect(shouldStripPath("tests/container-manager.ts", "pg-delta")).toBe(
      true,
    );
    expect(shouldStripPath("tests/global-setup.ts", "pg-delta")).toBe(true);
    expect(shouldStripPath("tests/integration/roundtrip.ts", "pg-delta")).toBe(
      true,
    );
    expect(shouldStripPath("tests/utils.ts", "pg-delta")).toBe(true);
  });

  test("strips base change classes", () => {
    expect(
      shouldStripPath(
        "src/core/objects/table/changes/table.base.ts",
        "pg-delta",
      ),
    ).toBe(true);
    expect(
      shouldStripPath("src/core/objects/view/changes/view.base.ts", "pg-delta"),
    ).toBe(true);
  });

  test("strips debug visualization", () => {
    expect(
      shouldStripPath("src/core/sort/debug-visualization.ts", "pg-delta"),
    ).toBe(true);
  });

  test("strips pg-topo test infrastructure patterns", () => {
    expect(shouldStripPath("test/global-setup.ts", "pg-topo")).toBe(true);
    expect(shouldStripPath("test/support/fingerprint.ts", "pg-topo")).toBe(
      true,
    );
    expect(
      shouldStripPath("test/support/postgres/postgres-container.ts", "pg-topo"),
    ).toBe(true);
    expect(shouldStripPath("test/support/randomized-input.ts", "pg-topo")).toBe(
      true,
    );
  });

  test("does not strip unknown packages", () => {
    expect(shouldStripPath("src/index.ts", "unknown-pkg")).toBe(false);
    expect(shouldStripPath("src/foo.test.ts", "unknown-pkg")).toBe(false);
  });
});

describe("stripLcovRecords", () => {
  test("strips cross-package leak records", () => {
    const input = [
      lcovRecord("src/core/catalog.diff.ts"),
      lcovRecord("../pg-topo/src/analyze-and-sort.ts"),
      lcovRecord("../pg-topo/src/graph/build-graph.ts"),
      lcovRecord("src/core/plan/create.ts"),
    ].join("\n");

    const { content, stripped, total } = stripLcovRecords(input, "pg-delta");
    expect(stripped).toBe(2);
    expect(total).toBe(4);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual([
      "src/core/catalog.diff.ts",
      "src/core/plan/create.ts",
    ]);
  });

  test("strips test file records", () => {
    const input = [
      lcovRecord("src/core/catalog.diff.ts"),
      lcovRecord("src/core/catalog.diff.test.ts"),
    ].join("\n");

    const { content, stripped, total } = stripLcovRecords(input, "pg-delta");
    expect(stripped).toBe(1);
    expect(total).toBe(2);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual(["src/core/catalog.diff.ts"]);
  });

  test("strips infrastructure file records", () => {
    const input = [
      lcovRecord("src/index.ts"),
      lcovRecord("tests/constants.ts"),
      lcovRecord("tests/container-manager.ts"),
      lcovRecord("src/core/sort/debug-visualization.ts"),
    ].join("\n");

    const { content, stripped, total } = stripLcovRecords(input, "pg-delta");
    expect(stripped).toBe(3);
    expect(total).toBe(4);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual(["src/index.ts"]);
  });

  test("strips base change class records", () => {
    const input = [
      lcovRecord("src/core/objects/table/changes/table.alter.ts"),
      lcovRecord("src/core/objects/table/changes/table.base.ts"),
    ].join("\n");

    const { content, stripped } = stripLcovRecords(input, "pg-delta");
    expect(stripped).toBe(1);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual(["src/core/objects/table/changes/table.alter.ts"]);
  });

  test("keeps everything for pg-topo source files", () => {
    const input = [
      lcovRecord("src/analyze-and-sort.ts"),
      lcovRecord("src/graph/build-graph.ts"),
    ].join("\n");

    const { content, stripped, total } = stripLcovRecords(input, "pg-topo");
    expect(stripped).toBe(0);
    expect(total).toBe(2);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual([
      "src/analyze-and-sort.ts",
      "src/graph/build-graph.ts",
    ]);
  });

  test("strips pg-topo test files", () => {
    const input = [
      lcovRecord("src/analyze-and-sort.ts"),
      lcovRecord("test/topo-sort.test.ts"),
    ].join("\n");

    const { content, stripped } = stripLcovRecords(input, "pg-topo");
    expect(stripped).toBe(1);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual(["src/analyze-and-sort.ts"]);
  });

  test("strips pg-topo test infrastructure files", () => {
    const input = [
      lcovRecord("src/analyze-and-sort.ts"),
      lcovRecord("src/graph/build-graph.ts"),
      lcovRecord("test/global-setup.ts"),
      lcovRecord("test/support/fingerprint.ts"),
      lcovRecord("test/support/postgres/postgres-container.ts"),
      lcovRecord("test/support/randomized-input.ts"),
    ].join("\n");

    const { content, stripped, total } = stripLcovRecords(input, "pg-topo");
    expect(stripped).toBe(4);
    expect(total).toBe(6);

    const sfLines = content
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3));
    expect(sfLines).toEqual([
      "src/analyze-and-sort.ts",
      "src/graph/build-graph.ts",
    ]);
  });

  test("preserves non-record content (preamble/trailing)", () => {
    const input = `TN:test-name
${lcovRecord("src/index.ts")}
`;
    const { content, stripped, total } = stripLcovRecords(input, "pg-delta");
    expect(stripped).toBe(0);
    expect(total).toBe(1);
    expect(content).toContain("TN:test-name");
    expect(content).toContain("SF:src/index.ts");
  });

  test("handles empty input", () => {
    const { content, stripped, total } = stripLcovRecords("", "pg-delta");
    expect(stripped).toBe(0);
    expect(total).toBe(0);
    expect(content).toBe("");
  });
});

describe("fixLcovContent", () => {
  test("rewrites relative paths", () => {
    const input = lcovRecord("src/core/catalog.diff.ts");
    const { content, fixed, total } = fixLcovContent(
      input,
      "/repo",
      "pg-delta",
    );
    expect(fixed).toBe(1);
    expect(total).toBe(1);
    expect(content).toContain("SF:packages/pg-delta/src/core/catalog.diff.ts");
  });

  test("rewrites absolute paths to relative", () => {
    const input = lcovRecord("/repo/src/core/catalog.diff.ts");
    const { content, fixed } = fixLcovContent(input, "/repo", "pg-delta");
    expect(fixed).toBe(1);
    expect(content).toContain("SF:packages/pg-delta/src/core/catalog.diff.ts");
  });

  test("normalizes absolute path with package segment to relative", () => {
    const input = lcovRecord(
      "/home/runner/work/pg-toolbelt/pg-toolbelt/packages/pg-delta/src/core/catalog.diff.ts",
    );
    const { content, fixed } = fixLcovContent(
      input,
      "/home/runner/work/pg-toolbelt/pg-toolbelt",
      "pg-delta",
    );
    expect(fixed).toBe(1);
    expect(content).toContain("SF:packages/pg-delta/src/core/catalog.diff.ts");
  });

  test("skips paths already containing package segment (relative)", () => {
    const input = lcovRecord("packages/pg-delta/src/index.ts");
    const { fixed } = fixLcovContent(input, "/repo", "pg-delta");
    expect(fixed).toBe(0);
  });
});

describe("COVERAGE_IGNORE", () => {
  test("pg-delta has all expected patterns", () => {
    const config = COVERAGE_IGNORE["pg-delta"];
    expect(config.skipTestFiles).toBe(true);
    expect(config.patterns).toContain("tests/constants.ts");
    expect(config.patterns).toContain("tests/container-manager.ts");
    expect(config.patterns).toContain("**/changes/*.base.ts");
    expect(config.patterns).toContain("src/core/sort/debug-visualization.ts");
  });

  test("pg-topo has skipTestFiles and test infrastructure patterns", () => {
    const config = COVERAGE_IGNORE["pg-topo"];
    expect(config.skipTestFiles).toBe(true);
    expect(config.patterns).toContain("test/global-setup.ts");
    expect(config.patterns).toContain("test/support/**");
  });
});
