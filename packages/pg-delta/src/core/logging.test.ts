import { describe, expect, test } from "bun:test";
import { parseDebugCategories, resolvePgDeltaLogLevel } from "./logging.ts";

describe("parseDebugCategories", () => {
  test("returns empty for undefined input", () => {
    expect(parseDebugCategories(undefined)).toEqual([]);
  });

  test("parses a specific pg-delta namespace", () => {
    expect(parseDebugCategories("pg-delta:declarative-apply")).toEqual([
      ["pg-delta", "declarative-apply"],
    ]);
  });

  test("normalizes wildcard namespaces to category prefixes", () => {
    expect(parseDebugCategories("pg-delta:*")).toEqual([["pg-delta"]]);
    expect(parseDebugCategories("pg-delta:graph:*")).toEqual([
      ["pg-delta", "graph"],
    ]);
  });

  test("ignores unrelated and negative debug tokens", () => {
    expect(parseDebugCategories("foo:*,-pg-delta:*")).toEqual([]);
  });

  test("deduplicates repeated category tokens", () => {
    expect(parseDebugCategories("pg-delta:graph,pg-delta:graph")).toEqual([
      ["pg-delta", "graph"],
    ]);
  });
});

describe("resolvePgDeltaLogLevel", () => {
  test("accepts valid log levels", () => {
    expect(resolvePgDeltaLogLevel("info")).toBe("info");
    expect(resolvePgDeltaLogLevel("debug")).toBe("debug");
  });

  test("falls back to warning for invalid log levels", () => {
    expect(resolvePgDeltaLogLevel("verbose")).toBe("warning");
    expect(resolvePgDeltaLogLevel(undefined)).toBe("warning");
  });
});
