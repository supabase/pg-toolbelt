import { describe, expect, test } from "vitest";
import { SqlFormatter } from "./format.ts";

describe("SqlFormatter", () => {
  test("keyword applies default (upper) casing", () => {
    const formatter = new SqlFormatter();
    expect(formatter.keyword("select")).toBe("SELECT");
  });

  test("keyword preserves, lowers, and uppers", () => {
    const preserve = new SqlFormatter({ keywordCase: "preserve" });
    const lower = new SqlFormatter({ keywordCase: "lower" });
    const upper = new SqlFormatter({ keywordCase: "upper" });

    expect(preserve.keyword("SeLeCt")).toBe("SeLeCt");
    expect(lower.keyword("SELECT")).toBe("select");
    expect(upper.keyword("select")).toBe("SELECT");
  });

  test("indent uses indentWidth and level", () => {
    const formatter = new SqlFormatter({ indentWidth: 2 });
    expect(formatter.indent()).toBe("  ");
    expect(formatter.indent(0)).toBe("");
    expect(formatter.indent(2)).toBe("    ");
    expect(formatter.indent(-1)).toBe("");
  });

  test("list handles trailing commas with indentation", () => {
    const formatter = new SqlFormatter({ commaStyle: "trailing" });
    const list = formatter.list(["a", "b", "c"], 1);
    expect(list).toBe("a,\n  b,\n  c");
  });

  test("list handles leading commas with indentation", () => {
    const formatter = new SqlFormatter({ commaStyle: "leading" });
    const list = formatter.list(["a", "b", "c"], 1);
    expect(list).toBe("  a\n  , b\n  , c");
  });

  test("list handles empty and single-item arrays", () => {
    const formatter = new SqlFormatter();
    expect(formatter.list([], 1)).toBe("");
    expect(formatter.list(["only"], 1)).toBe("only");
  });

  test("parens wraps content with optional multiline", () => {
    const formatter = new SqlFormatter();
    expect(formatter.parens("a, b")).toBe("(a, b)");
    expect(formatter.parens("line1\nline2", true)).toBe(
      "(\nline1\nline2\n)",
    );
    expect(formatter.parens("", true)).toBe("()");
  });

  test("alignColumns pads columns when enabled", () => {
    const formatter = new SqlFormatter();
    const rows = [
      ["id", "bigint", "PRIMARY KEY"],
      ["name", "text", "NOT NULL"],
    ];

    expect(formatter.alignColumns(rows)).toEqual([
      "id   bigint PRIMARY KEY",
      "name text   NOT NULL",
    ]);
  });

  test("alignColumns joins without padding when disabled", () => {
    const formatter = new SqlFormatter({ alignColumns: false });
    const rows = [
      ["id", "bigint", "PRIMARY KEY"],
      ["name", "text", "NOT NULL"],
    ];

    expect(formatter.alignColumns(rows)).toEqual([
      "id bigint PRIMARY KEY",
      "name text NOT NULL",
    ]);
  });

  test("alignColumns tolerates uneven rows and undefined values", () => {
    const formatter = new SqlFormatter();
    const rows = [["id", "int"], ["name", undefined, "NOT NULL"]];

    expect(formatter.alignColumns(rows)).toEqual([
      "id   int",
      "name     NOT NULL",
    ]);
  });
});
