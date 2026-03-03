import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FileEntry } from "../../core/export/types.ts";
import { assertSafePath, computeFileDiff } from "./export-display.ts";

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
      const diff = await computeFileDiff(dir, newFiles);

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
      const diff = await computeFileDiff(dir, newFiles);

      expect(diff.deleted).toContain("schemas/public/tables/old_table.sql");
      expect(diff.deleted).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
