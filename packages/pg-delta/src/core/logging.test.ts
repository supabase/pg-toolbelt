import { describe, expect, test } from "bun:test";
import {
  configurePgDeltaLogging,
  getPgDeltaLogger,
  parseDebugCategories,
  resolvePgDeltaLogLevel,
} from "./logging.ts";

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

describe("configurePgDeltaLogging", () => {
  test("enables debug logging only for matching debug categories", async () => {
    const logs: Array<{
      level: string;
      category: readonly string[];
      rawMessage: string;
      properties: Record<string, unknown>;
    }> = [];

    await configurePgDeltaLogging({
      level: "warning",
      debug: "pg-delta:graph",
      captureLogger: (entry) => {
        logs.push(entry);
      },
    });

    const graphLogger = getPgDeltaLogger("graph");
    const catalogLogger = getPgDeltaLogger("catalog");

    expect(graphLogger.isEnabledFor("debug")).toBe(true);
    expect(catalogLogger.isEnabledFor("debug")).toBe(false);

    graphLogger.debug("graph {value}", { value: 1 });
    catalogLogger.debug("catalog {value}", { value: 2 });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      level: "debug",
      category: ["pg-delta", "graph"],
      rawMessage: "graph {value}",
      properties: { value: 1 },
    });
  });

  test("still emits errors at the root log level", async () => {
    const logs: Array<{
      level: string;
      category: readonly string[];
      rawMessage: string;
      properties: Record<string, unknown>;
    }> = [];

    await configurePgDeltaLogging({
      level: "warning",
      captureLogger: (entry) => {
        logs.push(entry);
      },
    });

    const logger = getPgDeltaLogger("cli");
    logger.error("failed {code}", { code: "boom" });

    expect(logs).toEqual([
      {
        level: "error",
        category: ["pg-delta", "cli"],
        rawMessage: "failed {code}",
        properties: { code: "boom" },
      },
    ]);
  });
});
