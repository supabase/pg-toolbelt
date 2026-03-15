import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { Effect, type FileSystem } from "effect";
import type { FileEntry } from "../../core/export/types.ts";
import {
  assertSafePath,
  buildFileTree,
  computeFileDiff,
  formatDryRunNotice,
  formatExportSummary,
  formatFileLegend,
} from "./export-display.ts";

const runFs = <A>(effect: Effect.Effect<A, never, FileSystem.FileSystem>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(NodeFileSystem.layer)) as Effect.Effect<
      A,
      never,
      never
    >,
  );

// ============================================================================
// assertSafePath
// ============================================================================

describe("assertSafePath", () => {
  test("allows normal relative paths", () => {
    expect(() =>
      assertSafePath("schemas/public/tables/users.sql", "/tmp/out"),
    ).not.toThrow();
  });

  test("allows nested paths", () => {
    expect(() =>
      assertSafePath("cluster/extensions/pgcrypto.sql", "/tmp/out"),
    ).not.toThrow();
  });

  test("rejects path traversal with ..", () => {
    expect(() => assertSafePath("../../etc/passwd", "/tmp/out")).toThrow(
      "traversal",
    );
  });

  test("rejects path traversal embedded in path", () => {
    expect(() =>
      assertSafePath("schemas/../../../etc/passwd", "/tmp/out"),
    ).toThrow("traversal");
  });

  test("rejects absolute paths", () => {
    expect(() => assertSafePath("/etc/passwd", "/tmp/out")).toThrow(
      "traversal",
    );
  });
});

// ============================================================================
// computeFileDiff – SQL-only filtering
// ============================================================================

describe("computeFileDiff", () => {
  function makeFileEntry(relPath: string, sql = "-- content"): FileEntry {
    return {
      path: relPath,
      order: 0,
      statements: 1,
      sql,
      metadata: { objectType: "table" },
    };
  }

  test("non-SQL files in output dir are not marked as deleted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-export-test-"));
    try {
      await mkdir(path.join(dir, "schemas/public/tables"), { recursive: true });
      await writeFile(
        path.join(dir, "schemas/public/tables/users.sql"),
        "-- users",
      );
      await writeFile(path.join(dir, "README.md"), "# readme");
      await writeFile(path.join(dir, ".gitkeep"), "");

      const newFiles = [makeFileEntry("schemas/public/tables/users.sql")];
      const diff = await runFs(computeFileDiff(dir, newFiles));

      expect(diff.deleted).not.toContain("README.md");
      expect(diff.deleted).not.toContain(".gitkeep");
      expect(diff.deleted).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stale SQL files are still marked as deleted", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-export-test-"));
    try {
      await mkdir(path.join(dir, "schemas/public/tables"), { recursive: true });
      await writeFile(
        path.join(dir, "schemas/public/tables/users.sql"),
        "-- users",
      );
      await writeFile(
        path.join(dir, "schemas/public/tables/old_table.sql"),
        "-- old",
      );

      const newFiles = [makeFileEntry("schemas/public/tables/users.sql")];
      const diff = await runFs(computeFileDiff(dir, newFiles));

      expect(diff.deleted).toContain("schemas/public/tables/old_table.sql");
      expect(diff.deleted).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// formatFileLegend
// ============================================================================

describe("formatFileLegend", () => {
  test("with colors preserves legend content", () => {
    const result = formatFileLegend(true);
    expect(result).toContain("created");
    expect(result).toContain("updated");
    expect(result).toContain("deleted");
  });

  test("without colors produces plain text", () => {
    const result = formatFileLegend(false);
    expect(result).toBe("+ created   ~ updated   - deleted");
  });
});

// ============================================================================
// formatExportSummary
// ============================================================================

describe("formatExportSummary", () => {
  test("with colors preserves content", () => {
    const diff = {
      created: ["a.sql"],
      updated: ["b.sql"],
      deleted: ["c.sql"],
      unchanged: [],
    };
    const result = formatExportSummary(diff, false, true);
    expect(result).toContain("Created: 1 file(s)");
    expect(result).toContain("Updated: 1 file(s)");
    expect(result).toContain("Deleted: 1 file(s)");
  });

  test("without colors produces plain text", () => {
    const diff = {
      created: ["a.sql"],
      updated: ["b.sql"],
      deleted: ["c.sql"],
      unchanged: ["d.sql"],
    };
    const result = formatExportSummary(diff, false, false);
    expect(result).toContain("Created: 1 file(s)");
    expect(result).toContain("Updated: 1 file(s)");
    expect(result).toContain("Deleted: 1 file(s)");
    expect(result).toContain("Unchanged: 1 file(s)");
  });

  test("dry-run uses 'Would' phrasing", () => {
    const diff = {
      created: ["a.sql"],
      updated: [],
      deleted: [],
      unchanged: [],
    };
    const result = formatExportSummary(diff, true, false);
    expect(result).toContain("Would create: 1 file(s)");
  });

  test("returns empty string when no changes", () => {
    const diff = { created: [], updated: [], deleted: [], unchanged: [] };
    expect(formatExportSummary(diff, false, false)).toBe("");
  });
});

// ============================================================================
// buildFileTree
// ============================================================================

describe("buildFileTree", () => {
  test("without colors includes prefix symbols without ANSI", () => {
    const diff = {
      created: ["a.sql"],
      updated: ["b.sql"],
      deleted: ["c.sql"],
      unchanged: [],
    };
    const result = buildFileTree(["a.sql", "b.sql", "c.sql"], "out", {
      diff,
      useColors: false,
    });
    expect(result).toContain("+ a.sql");
    expect(result).toContain("~ b.sql");
    expect(result).toContain("- c.sql");
  });

  test("with colors preserves content", () => {
    const diff = {
      created: ["a.sql"],
      updated: [],
      deleted: [],
      unchanged: [],
    };
    const result = buildFileTree(["a.sql"], "out", {
      diff,
      useColors: true,
    });
    expect(result).toContain("a.sql");
  });
});

// ============================================================================
// formatDryRunNotice
// ============================================================================

describe("formatDryRunNotice", () => {
  test("with colors preserves content", () => {
    const result = formatDryRunNotice("tip text", true);
    expect(result.notice).toContain("dry-run");
    expect(result.tip).toContain("tip text");
  });

  test("without colors produces plain text", () => {
    const result = formatDryRunNotice("tip text", false);
    expect(result.notice).toContain("dry-run");
    expect(result.tip).toBe("tip text");
  });
});
