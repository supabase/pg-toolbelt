import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "./constants.ts";
import type { NormalizedOptions } from "./types.ts";
import { wrapStatement } from "./wrap.ts";

const opts: NormalizedOptions = { ...DEFAULT_OPTIONS, maxWidth: 40 };
const noWrap = new Set<string>();

describe("wrapStatement", () => {
  it("keeps short lines unwrapped", () => {
    const result = wrapStatement("SELECT 1", opts, noWrap);
    expect(result).toBe("SELECT 1");
  });

  it("wraps long lines at whitespace before maxWidth", () => {
    const long = "SELECT column_a, column_b, column_c, column_d FROM my_table";
    const result = wrapStatement(long, opts, noWrap);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].length).toBeLessThanOrEqual(40);
  });

  it("does not wrap comment lines regardless of length", () => {
    const comment =
      "-- this is a very long comment that exceeds the maximum line width significantly";
    const result = wrapStatement(comment, opts, noWrap);
    expect(result).toBe(comment);
  });

  it("does not wrap lines containing noWrap placeholders", () => {
    const placeholder = "__PGDELTA_PLACEHOLDER_0__";
    const noWrapSet = new Set([placeholder]);
    const long = `CREATE FUNCTION foo() ${placeholder}`;
    const result = wrapStatement(long, { ...opts, maxWidth: 20 }, noWrapSet);
    expect(result.split("\n").length).toBe(1);
  });

  it("adds proper continuation indentation", () => {
    const long = "SELECT column_a, column_b, column_c, column_d FROM my_table";
    const result = wrapStatement(long, opts, noWrap);
    const lines = result.split("\n");
    if (lines.length > 1) {
      expect(lines[1]).toMatch(/^\s+/);
    }
  });
});
