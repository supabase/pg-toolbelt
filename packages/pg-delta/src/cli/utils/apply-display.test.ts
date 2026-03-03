import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Diagnostic, DiagnosticCode } from "@supabase/pg-topo";
import type { StatementError } from "../../core/declarative-apply/round-apply.ts";
import {
  buildDiagnosticDisplayItems,
  type DiagnosticDisplayEntry,
  formatStatementError,
  positionToLineColumn,
  requiredObjectKeyFromDiagnostic,
  resolveSqlFilePath,
} from "./apply-display.ts";

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
      const result = await resolveSqlFilePath(dir, "schemas/table.sql");
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
      const result = await resolveSqlFilePath(filePath, "schemas/table.sql");
      expect(result).toBe(path.join(dir, "schemas/table.sql"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stat throws falls back to joining schemaPath as dir", async () => {
    const result = await resolveSqlFilePath("/nonexistent/path", "table.sql");
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
    const result = await formatStatementError(
      makeErr({ id: "no-colon-here" }),
      "/tmp",
    );
    expect(result).toContain("ERROR:  something failed");
    expect(result).toContain("SQL state: 42601");
    expect(result).toContain("Location: no-colon-here");
    expect(result).not.toContain("Detail:");
    expect(result).not.toContain("Hint:");
    expect(result).not.toContain("Character:");
  });

  test("includes detail and hint when present", async () => {
    const result = await formatStatementError(
      makeErr({ detail: "some detail", hint: "try this" }),
      "/tmp",
    );
    expect(result).toContain("Detail: some detail");
    expect(result).toContain("Hint: try this");
  });

  test("includes Character and Context when position is set", async () => {
    const sql = "SELECT * FROM missing_table WHERE id = 1";
    const result = await formatStatementError(
      makeErr({ position: 15, sql, id: "raw-id" }),
      "/tmp",
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

      const result = await formatStatementError(
        makeErr({ id: "tables.sql:0", sql, position: 14 }),
        dir,
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

      const result = await formatStatementError(
        makeErr({ id: "tables.sql:0", sql }),
        dir,
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

      const result = await formatStatementError(
        makeErr({
          id: "tables.sql:2",
          sql: "DROP TABLE nonexistent;",
        }),
        dir,
      );
      expect(result).toContain("Location: tables.sql (statement 2)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parseable id with position but file read fails uses SQL-based line/col", async () => {
    const sql = "SELECT\n  1\n  + bad_col";
    const result = await formatStatementError(
      makeErr({ id: "missing/file.sql:0", sql, position: 14 }),
      "/nonexistent",
    );
    expect(result).toMatch(
      /Location: missing\/file\.sql \(statement 0, line \d+, column \d+\)/,
    );
  });

  test("parseable id without position and file read fails shows statement index only", async () => {
    const result = await formatStatementError(
      makeErr({ id: "missing/file.sql:1" }),
      "/nonexistent",
    );
    expect(result).toContain("Location: missing/file.sql (statement 1)");
    expect(result).not.toContain("line");
    expect(result).not.toContain("column");
  });

  test("all output lines are indented with two spaces", async () => {
    const result = await formatStatementError(
      makeErr({ detail: "d", hint: "h", position: 1, sql: "SELECT 1" }),
      "/tmp",
    );
    for (const line of result.split("\n")) {
      expect(line).toMatch(/^ {2}/);
    }
  });
});
