import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import type { Diagnostic, DiagnosticCode } from "@supabase/pg-topo";
import { Effect, type FileSystem } from "effect";
import type { StatementError } from "../../core/declarative-apply/round-apply.ts";
import {
  buildDiagnosticDisplayItems,
  colorStatementError,
  type DiagnosticDisplayEntry,
  type DiagnosticDisplayItem,
  formatDiagnosticsBlock,
  formatRoundStatus,
  formatStatementError,
  positionToLineColumn,
  requiredObjectKeyFromDiagnostic,
  resolveSqlFilePath,
} from "./apply-display.ts";

const runFs = <A>(effect: Effect.Effect<A, never, FileSystem.FileSystem>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(NodeFileSystem.layer)) as Effect.Effect<
      A,
      never,
      never
    >,
  );

describe("positionToLineColumn", () => {
  test("single line, position at start", () => {
    expect(positionToLineColumn("hello", 1)).toEqual({ line: 1, column: 1 });
  });

  test("single line, position in the middle", () => {
    expect(positionToLineColumn("hello", 3)).toEqual({ line: 1, column: 3 });
  });

  test("single line, position at end", () => {
    expect(positionToLineColumn("hello", 5)).toEqual({ line: 1, column: 5 });
  });

  test("multi-line, first line", () => {
    expect(positionToLineColumn("ab\ncd\nef", 2)).toEqual({
      line: 1,
      column: 2,
    });
  });

  test("multi-line, second line start", () => {
    expect(positionToLineColumn("ab\ncd\nef", 4)).toEqual({
      line: 2,
      column: 1,
    });
  });

  test("multi-line, third line", () => {
    expect(positionToLineColumn("ab\ncd\nef", 7)).toEqual({
      line: 3,
      column: 1,
    });
  });

  test("position past end falls back to last line", () => {
    expect(positionToLineColumn("ab\ncd", 100)).toEqual({
      line: 2,
      column: 3,
    });
  });

  test("empty string", () => {
    expect(positionToLineColumn("", 1)).toEqual({ line: 1, column: 1 });
  });
});

describe("requiredObjectKeyFromDiagnostic", () => {
  test("returns value when present and non-empty", () => {
    const diag: Diagnostic = {
      code: "UNRESOLVED_DEPENDENCY",
      message: "warning",
      details: { requiredObjectKey: "public.users" },
    };
    expect(requiredObjectKeyFromDiagnostic(diag)).toBe("public.users");
  });

  test("returns undefined for empty string", () => {
    const diag: Diagnostic = {
      code: "UNRESOLVED_DEPENDENCY",
      message: "warning",
      details: { requiredObjectKey: "" },
    };
    expect(requiredObjectKeyFromDiagnostic(diag)).toBeUndefined();
  });

  test("returns undefined when details is undefined", () => {
    const diag: Diagnostic = {
      code: "UNRESOLVED_DEPENDENCY",
      message: "warning",
    };
    expect(requiredObjectKeyFromDiagnostic(diag)).toBeUndefined();
  });

  test("returns undefined for non-string value", () => {
    const diag: Diagnostic = {
      code: "UNRESOLVED_DEPENDENCY",
      message: "warning",
      details: { requiredObjectKey: 42 },
    };
    expect(requiredObjectKeyFromDiagnostic(diag)).toBeUndefined();
  });
});

describe("buildDiagnosticDisplayItems", () => {
  const makeDiag = (
    code: DiagnosticCode,
    message: string,
    suggestedFix?: string,
  ): Diagnostic => ({ code, message, suggestedFix });

  test("ungrouped mode returns one item per entry", () => {
    const entries: DiagnosticDisplayEntry[] = [
      {
        diagnostic: makeDiag("PARSE_ERROR", "err1"),
        location: "file1.sql:1",
      },
      {
        diagnostic: makeDiag("PARSE_ERROR", "err1"),
        location: "file2.sql:5",
      },
    ];
    const items = buildDiagnosticDisplayItems(entries, false);
    expect(items).toHaveLength(2);
    expect(items[0].locations).toEqual(["file1.sql:1"]);
    expect(items[1].locations).toEqual(["file2.sql:5"]);
  });

  test("ungrouped mode: entry without location gets empty locations array", () => {
    const entries: DiagnosticDisplayEntry[] = [
      { diagnostic: makeDiag("PARSE_ERROR", "err1") },
    ];
    const items = buildDiagnosticDisplayItems(entries, false);
    expect(items[0].locations).toEqual([]);
  });

  test("grouped mode merges same code/message entries", () => {
    const entries: DiagnosticDisplayEntry[] = [
      { diagnostic: makeDiag("PARSE_ERROR", "err1"), location: "a.sql:1" },
      { diagnostic: makeDiag("PARSE_ERROR", "err1"), location: "b.sql:2" },
      {
        diagnostic: makeDiag("UNRESOLVED_DEPENDENCY", "err2", "fix it"),
        location: "c.sql:3",
      },
    ];
    const items = buildDiagnosticDisplayItems(entries, true);
    expect(items).toHaveLength(2);
    expect(items[0].locations).toEqual(["a.sql:1", "b.sql:2"]);
    expect(items[1].code).toBe("UNRESOLVED_DEPENDENCY");
    expect(items[1].suggestedFix).toBe("fix it");
  });

  test("grouped mode: entry without location gets empty locations", () => {
    const entries: DiagnosticDisplayEntry[] = [
      { diagnostic: makeDiag("PARSE_ERROR", "err1") },
    ];
    const items = buildDiagnosticDisplayItems(entries, true);
    expect(items[0].locations).toEqual([]);
  });

  test("grouped mode deduplicates identical locations", () => {
    const entries: DiagnosticDisplayEntry[] = [
      { diagnostic: makeDiag("PARSE_ERROR", "err1"), location: "a.sql:1" },
      { diagnostic: makeDiag("PARSE_ERROR", "err1"), location: "a.sql:1" },
    ];
    const items = buildDiagnosticDisplayItems(entries, true);
    expect(items[0].locations).toEqual(["a.sql:1"]);
  });

  test("grouped mode preserves requiredObjectKey in group key", () => {
    const entries: DiagnosticDisplayEntry[] = [
      {
        diagnostic: makeDiag("PARSE_ERROR", "err1"),
        location: "a.sql:1",
        requiredObjectKey: "key1",
      },
      {
        diagnostic: makeDiag("PARSE_ERROR", "err1"),
        location: "b.sql:2",
        requiredObjectKey: "key2",
      },
    ];
    const items = buildDiagnosticDisplayItems(entries, true);
    expect(items).toHaveLength(2);
    expect(items[0].requiredObjectKey).toBe("key1");
    expect(items[1].requiredObjectKey).toBe("key2");
  });
});

describe("resolveSqlFilePath", () => {
  test("schemaPath is a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-apply-test-"));
    try {
      const result = await runFs(resolveSqlFilePath(dir, "schemas/table.sql"));
      expect(result).toBe(path.join(dir, "schemas/table.sql"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("schemaPath is a file uses dirname", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-apply-test-"));
    try {
      const filePath = path.join(dir, "schema.sql");
      await writeFile(filePath, "");
      const result = await runFs(
        resolveSqlFilePath(filePath, "schemas/table.sql"),
      );
      expect(result).toBe(path.join(dir, "schemas/table.sql"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stat throws falls back to joining schemaPath as dir", async () => {
    const result = await runFs(
      resolveSqlFilePath("/nonexistent/path", "table.sql"),
    );
    expect(result).toBe(path.join("/nonexistent/path", "table.sql"));
  });
});

describe("formatStatementError", () => {
  function makeErr(
    overrides: Partial<StatementError> & {
      id?: string;
      sql?: string;
    } = {},
  ): StatementError {
    const { id, sql, ...rest } = overrides;
    return {
      message: "something failed",
      code: "42601",
      isDependencyError: false,
      statement: { id: id ?? "raw-statement", sql: sql ?? "" },
      ...rest,
    };
  }

  test("minimal error with unparseable id", async () => {
    const result = await runFs(
      formatStatementError(makeErr({ id: "no-colon-here" }), "/tmp"),
    );
    expect(result).toContain("ERROR:  something failed");
    expect(result).toContain("SQL state: 42601");
    expect(result).toContain("Location: no-colon-here");
    expect(result).not.toContain("Detail:");
    expect(result).not.toContain("Hint:");
    expect(result).not.toContain("Character:");
  });

  test("includes detail and hint when present", async () => {
    const result = await runFs(
      formatStatementError(
        makeErr({ detail: "some detail", hint: "try this" }),
        "/tmp",
      ),
    );
    expect(result).toContain("Detail: some detail");
    expect(result).toContain("Hint: try this");
  });

  test("includes Character and Context when position is set", async () => {
    const sql = "SELECT * FROM missing_table WHERE id = 1";
    const result = await runFs(
      formatStatementError(
        makeErr({ position: 15, sql, id: "raw-id" }),
        "/tmp",
      ),
    );
    expect(result).toContain("Character: 15");
    expect(result).toContain("Context:");
  });

  test("parseable id with file containing the SQL resolves line:col", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-apply-test-"));
    try {
      const sql = "CREATE TABLE foo (id int);";
      const fileContent = `-- header\n\n${sql}\n`;
      await writeFile(path.join(dir, "tables.sql"), fileContent);

      const result = await runFs(
        formatStatementError(
          makeErr({ id: "tables.sql:0", sql, position: 14 }),
          dir,
        ),
      );
      expect(result).toMatch(/Location: tables\.sql:\d+:\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parseable id with file containing SQL but no position resolves line only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-apply-test-"));
    try {
      const sql = "CREATE TABLE bar (id int);";
      const fileContent = `-- header\n${sql}\n`;
      await writeFile(path.join(dir, "tables.sql"), fileContent);

      const result = await runFs(
        formatStatementError(makeErr({ id: "tables.sql:0", sql }), dir),
      );
      expect(result).toMatch(/Location: tables\.sql:\d+$/m);
      expect(result).not.toMatch(/Location: tables\.sql:\d+:\d+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parseable id with file but SQL not found falls back to statement index", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-apply-test-"));
    try {
      await writeFile(
        path.join(dir, "tables.sql"),
        "-- completely different content",
      );

      const result = await runFs(
        formatStatementError(
          makeErr({
            id: "tables.sql:2",
            sql: "DROP TABLE nonexistent;",
          }),
          dir,
        ),
      );
      expect(result).toContain("Location: tables.sql (statement 2)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parseable id with position but file read fails uses SQL-based line/col", async () => {
    const sql = "SELECT\n  1\n  + bad_col";
    const result = await runFs(
      formatStatementError(
        makeErr({ id: "missing/file.sql:0", sql, position: 14 }),
        "/nonexistent",
      ),
    );
    expect(result).toMatch(
      /Location: missing\/file\.sql \(statement 0, line \d+, column \d+\)/,
    );
  });

  test("parseable id without position and file read fails shows statement index only", async () => {
    const result = await runFs(
      formatStatementError(
        makeErr({ id: "missing/file.sql:1" }),
        "/nonexistent",
      ),
    );
    expect(result).toContain("Location: missing/file.sql (statement 1)");
    expect(result).not.toContain("line");
    expect(result).not.toContain("column");
  });

  test("all output lines are indented with two spaces", async () => {
    const result = await runFs(
      formatStatementError(
        makeErr({ detail: "d", hint: "h", position: 1, sql: "SELECT 1" }),
        "/tmp",
      ),
    );
    for (const line of result.split("\n")) {
      expect(line).toMatch(/^ {2}/);
    }
  });
});

// ============================================================================
// formatRoundStatus
// ============================================================================

describe("formatRoundStatus", () => {
  test("plain text (no colors) shows all parts", () => {
    const result = formatRoundStatus(
      { round: 1, applied: 5, deferred: 2, failed: 1, errors: [] },
      false,
    );
    expect(result).toBe("Round 1:  5 applied  2 deferred  1 failed");
  });

  test("omits deferred and failed when zero", () => {
    const result = formatRoundStatus(
      { round: 3, applied: 10, deferred: 0, failed: 0, errors: [] },
      false,
    );
    expect(result).toBe("Round 3:  10 applied");
  });

  test("with colors enabled still includes content", () => {
    const result = formatRoundStatus(
      { round: 1, applied: 5, deferred: 2, failed: 0, errors: [] },
      true,
    );
    expect(result).toContain("Round 1:");
    expect(result).toContain("5 applied");
    expect(result).toContain("2 deferred");
  });
});

// ============================================================================
// formatDiagnosticsBlock
// ============================================================================

describe("formatDiagnosticsBlock", () => {
  const makeItem = (
    overrides: Partial<DiagnosticDisplayItem> = {},
  ): DiagnosticDisplayItem => ({
    code: "PARSE_ERROR",
    message: "something went wrong",
    locations: [],
    ...overrides,
  });

  test("renders header with warning count", () => {
    const result = formatDiagnosticsBlock([makeItem()], 3, {
      useColors: false,
      ungroupDiagnostics: false,
    });
    expect(result).toContain("3 diagnostic(s) from static analysis:");
  });

  test("renders code and message for each item", () => {
    const result = formatDiagnosticsBlock(
      [makeItem({ code: "CYCLE_EDGE_SKIPPED", message: "cycle detected" })],
      1,
      { useColors: false, ungroupDiagnostics: false },
    );
    expect(result).toContain("[CYCLE_EDGE_SKIPPED]");
    expect(result).toContain("cycle detected");
  });

  test("shows location and occurrence count when grouped", () => {
    const result = formatDiagnosticsBlock(
      [
        makeItem({
          locations: ["a.sql:1", "b.sql:2", "c.sql:3"],
        }),
      ],
      1,
      { useColors: false, ungroupDiagnostics: false },
    );
    expect(result).toContain("(a.sql:1)");
    expect(result).toContain("x3");
    expect(result).toContain("at a.sql:1");
    expect(result).toContain("at b.sql:2");
    expect(result).toContain("at c.sql:3");
  });

  test("respects previewLimit for locations", () => {
    const locations = Array.from({ length: 8 }, (_, i) => `file${i}.sql:1`);
    const result = formatDiagnosticsBlock([makeItem({ locations })], 1, {
      useColors: false,
      ungroupDiagnostics: false,
      previewLimit: 3,
    });
    expect(result).toContain("at file0.sql:1");
    expect(result).toContain("at file2.sql:1");
    expect(result).not.toContain("at file3.sql:1");
    expect(result).toContain("... and 5 more location(s)");
  });

  test("shows requiredObjectKey when grouped", () => {
    const result = formatDiagnosticsBlock(
      [makeItem({ requiredObjectKey: "public.users" })],
      1,
      { useColors: false, ungroupDiagnostics: false },
    );
    expect(result).toContain("-> Object: public.users");
  });

  test("shows suggestedFix", () => {
    const result = formatDiagnosticsBlock(
      [makeItem({ suggestedFix: "Add a CREATE statement" })],
      1,
      { useColors: false, ungroupDiagnostics: false },
    );
    expect(result).toContain("-> Fix: Add a CREATE statement");
  });

  test("ungrouped mode skips locations list and object key", () => {
    const result = formatDiagnosticsBlock(
      [
        makeItem({
          locations: ["a.sql:1", "b.sql:2"],
          requiredObjectKey: "public.foo",
        }),
      ],
      1,
      { useColors: false, ungroupDiagnostics: true },
    );
    expect(result).not.toContain("at a.sql:1");
    expect(result).not.toContain("-> Object:");
  });

  test("without colors produces same content as with colors (in non-TTY)", () => {
    const withColors = formatDiagnosticsBlock([makeItem()], 1, {
      useColors: true,
      ungroupDiagnostics: false,
    });
    const withoutColors = formatDiagnosticsBlock([makeItem()], 1, {
      useColors: false,
      ungroupDiagnostics: false,
    });
    // Both should contain the diagnostic content
    expect(withColors).toContain("[PARSE_ERROR]");
    expect(withoutColors).toContain("[PARSE_ERROR]");
  });
});

// ============================================================================
// colorStatementError
// ============================================================================

describe("colorStatementError", () => {
  test("returns unmodified string when colors disabled", () => {
    expect(colorStatementError("error text", "error", false)).toBe(
      "error text",
    );
    expect(colorStatementError("warning text", "warning", false)).toBe(
      "warning text",
    );
  });

  test("preserves content with colors enabled", () => {
    const errResult = colorStatementError("error text", "error", true);
    expect(errResult).toContain("error text");
    const warnResult = colorStatementError("warning text", "warning", true);
    expect(warnResult).toContain("warning text");
  });
});
