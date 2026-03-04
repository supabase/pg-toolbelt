import { describe, expect, test } from "bun:test";
import type { Change } from "../../change.types.ts";
import { compileFilterDSL, evaluatePattern } from "./dsl.ts";

const tableCreate = {
  objectType: "table",
  operation: "create",
  scope: "object",
  table: { schema: "public", name: "t" },
  requires: ["schema:public"],
} as unknown as Change;

const viewAlter = {
  objectType: "view",
  operation: "alter",
  scope: "comment",
  view: { schema: "private", name: "v" },
  requires: ["schema:private", "type:auth.users"],
} as unknown as Change;

const roleDrop = {
  objectType: "role",
  operation: "drop",
  scope: "object",
  role: { name: "admin" },
  requires: [],
} as unknown as Change;

describe("evaluatePattern", () => {
  describe("core properties", () => {
    test("type match", () => {
      expect(evaluatePattern({ type: "table" }, tableCreate)).toBe(true);
    });

    test("type mismatch", () => {
      expect(evaluatePattern({ type: "view" }, tableCreate)).toBe(false);
    });

    test("operation match", () => {
      expect(evaluatePattern({ operation: "create" }, tableCreate)).toBe(true);
    });

    test("operation mismatch", () => {
      expect(evaluatePattern({ operation: "drop" }, tableCreate)).toBe(false);
    });

    test("scope match", () => {
      expect(evaluatePattern({ scope: "object" }, tableCreate)).toBe(true);
    });

    test("scope mismatch", () => {
      expect(evaluatePattern({ scope: "comment" }, tableCreate)).toBe(false);
    });

    test("multiple core properties AND together", () => {
      expect(
        evaluatePattern({ type: "table", operation: "create" }, tableCreate),
      ).toBe(true);
      expect(
        evaluatePattern({ type: "table", operation: "drop" }, tableCreate),
      ).toBe(false);
    });

    test("empty pattern matches everything", () => {
      expect(evaluatePattern({}, tableCreate)).toBe(true);
      expect(evaluatePattern({}, roleDrop)).toBe(true);
    });
  });

  describe("composition patterns", () => {
    test("not negates a pattern", () => {
      expect(evaluatePattern({ not: { type: "table" } }, tableCreate)).toBe(
        false,
      );
      expect(evaluatePattern({ not: { type: "view" } }, tableCreate)).toBe(
        true,
      );
    });

    test("and requires all to match", () => {
      expect(
        evaluatePattern(
          { and: [{ type: "table" }, { operation: "create" }] },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { and: [{ type: "table" }, { operation: "drop" }] },
          tableCreate,
        ),
      ).toBe(false);
    });

    test("or requires any to match", () => {
      expect(
        evaluatePattern(
          { or: [{ type: "table" }, { type: "view" }] },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { or: [{ type: "role" }, { type: "view" }] },
          tableCreate,
        ),
      ).toBe(false);
    });

    test("nested composition", () => {
      expect(
        evaluatePattern(
          { not: { or: [{ type: "role" }, { type: "view" }] } },
          tableCreate,
        ),
      ).toBe(true);
    });
  });

  describe("requiresMatching", () => {
    test("prefix match on requires array", () => {
      expect(
        evaluatePattern({ requiresMatching: ["schema:public"] }, tableCreate),
      ).toBe(true);
      expect(
        evaluatePattern({ requiresMatching: ["schema:"] }, tableCreate),
      ).toBe(true);
    });

    test("no match when prefix absent", () => {
      expect(
        evaluatePattern({ requiresMatching: ["type:auth."] }, tableCreate),
      ).toBe(false);
    });

    test("matches when any prefix matches any requires entry", () => {
      expect(
        evaluatePattern({ requiresMatching: ["type:auth."] }, viewAlter),
      ).toBe(true);
    });

    test("no match when requires is empty", () => {
      expect(evaluatePattern({ requiresMatching: ["schema:"] }, roleDrop)).toBe(
        false,
      );
    });
  });

  describe("extracted properties", () => {
    test("schema as string exact match", () => {
      expect(evaluatePattern({ schema: "public" }, tableCreate)).toBe(true);
      expect(evaluatePattern({ schema: "private" }, tableCreate)).toBe(false);
    });

    test("schema as array checks inclusion", () => {
      expect(
        evaluatePattern({ schema: ["public", "private"] }, tableCreate),
      ).toBe(true);
      expect(
        evaluatePattern({ schema: ["private", "auth"] }, tableCreate),
      ).toBe(false);
    });

    test("null extracted value returns false", () => {
      expect(evaluatePattern({ schema: "public" }, roleDrop)).toBe(false);
    });

    test("unknown property key is ignored", () => {
      const pattern = { unknownKey: "value" } as Record<string, unknown>;
      expect(
        evaluatePattern(
          pattern as Parameters<typeof evaluatePattern>[0],
          tableCreate,
        ),
      ).toBe(true);
    });

    test("cascade property is ignored and does not affect match", () => {
      expect(
        evaluatePattern(
          { type: "table", cascade: true },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { type: "table", cascade: false },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { not: { schema: "auth" }, cascade: true },
          tableCreate,
        ),
      ).toBe(true);
    });
  });
});

describe("compileFilterDSL", () => {
  test("returns a function that evaluates the pattern", () => {
    const filter = compileFilterDSL({ type: "table" });
    expect(typeof filter).toBe("function");
    expect(filter(tableCreate)).toBe(true);
    expect(filter(roleDrop)).toBe(false);
  });

  test("works with composition patterns", () => {
    const filter = compileFilterDSL({
      or: [{ type: "table" }, { type: "role" }],
    });
    expect(filter(tableCreate)).toBe(true);
    expect(filter(roleDrop)).toBe(true);
    expect(filter(viewAlter)).toBe(false);
  });
});
