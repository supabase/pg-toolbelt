import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { protectSegments, restorePlaceholders } from "./protect.ts";

describe("protectSegments", () => {
  it("protects function body after AS", () => {
    const sql = "CREATE FUNCTION foo() RETURNS void AS $$ BEGIN NULL; END; $$";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain("BEGIN NULL");
    expect(result.placeholders.size).toBeGreaterThan(0);
  });

  it("protects view body after AS", () => {
    const sql = "CREATE VIEW v AS SELECT 1";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain("SELECT 1");
  });

  it("protects standalone dollar-quoted blocks", () => {
    const sql = "SELECT $$hello world$$";
    const result = protectSegments(sql, {
      ...DEFAULT_OPTIONS,
      preserveRoutineBodies: false,
      preserveViewBodies: false,
      preserveRuleBodies: false,
    });
    expect(result.text).toContain("__PGDELTA_PLACEHOLDER_");
    expect(result.text).not.toContain("hello world");
  });
});

describe("restorePlaceholders", () => {
  it("restores placeholders to original values", () => {
    const placeholders = new Map<string, string>();
    placeholders.set("__PGDELTA_PLACEHOLDER_0__", "AS $$ body $$");
    const text = "CREATE FUNCTION foo() __PGDELTA_PLACEHOLDER_0__";
    const restored = restorePlaceholders(text, placeholders);
    expect(restored).toBe("CREATE FUNCTION foo() AS $$ body $$");
  });

  it("correctly handles $ characters in restored values", () => {
    const placeholders = new Map<string, string>();
    placeholders.set("__PGDELTA_PLACEHOLDER_0__", "$$price$$");
    const text = "SELECT __PGDELTA_PLACEHOLDER_0__";
    const restored = restorePlaceholders(text, placeholders);
    expect(restored).toBe("SELECT $$price$$");
  });

  it("round-trips protect → restore to produce original text", () => {
    const sql =
      "CREATE FUNCTION add(a int, b int) RETURNS int AS $$ BEGIN RETURN a + b; END; $$ LANGUAGE plpgsql";
    const result = protectSegments(sql, DEFAULT_OPTIONS);
    const restored = restorePlaceholders(result.text, result.placeholders);
    expect(restored).toBe(sql);
  });
});
