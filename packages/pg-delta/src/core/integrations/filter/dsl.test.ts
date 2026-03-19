import { describe, expect, test } from "bun:test";
import type { Change } from "../../change.types.ts";
import { compileFilterDSL, evaluatePattern } from "./dsl.ts";

const tableCreate = {
  objectType: "table",
  operation: "create",
  scope: "object",
  table: {
    schema: "public",
    name: "t",
    owner: "postgres",
    is_partition: false,
  },
  requires: ["schema:public"],
  creates: ["table:public.t"],
} as unknown as Change;

const viewAlter = {
  objectType: "view",
  operation: "alter",
  scope: "comment",
  view: { schema: "private", name: "v", owner: "admin" },
  requires: ["schema:private", "type:auth.users"],
} as unknown as Change;

const roleDrop = {
  objectType: "role",
  operation: "drop",
  scope: "object",
  role: { name: "admin" },
  requires: [],
} as unknown as Change;

const membershipChange = {
  objectType: "role",
  operation: "create",
  scope: "membership",
  member: "app_user",
  role: { name: "admin_group" },
  requires: [],
} as unknown as Change;

describe("evaluatePattern", () => {
  describe("bare key matching (top-level properties)", () => {
    test("objectType match", () => {
      expect(evaluatePattern({ objectType: "table" }, tableCreate)).toBe(true);
    });

    test("objectType mismatch", () => {
      expect(evaluatePattern({ objectType: "view" }, tableCreate)).toBe(false);
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

    test("multiple bare keys AND together", () => {
      expect(
        evaluatePattern(
          { objectType: "table", operation: "create" },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { objectType: "table", operation: "drop" },
          tableCreate,
        ),
      ).toBe(false);
    });

    test("empty pattern matches everything", () => {
      expect(evaluatePattern({}, tableCreate)).toBe(true);
      expect(evaluatePattern({}, roleDrop)).toBe(true);
    });
  });

  describe("path key matching (model sub-object properties)", () => {
    test("exact path match", () => {
      expect(evaluatePattern({ "table/schema": "public" }, tableCreate)).toBe(
        true,
      );
      expect(evaluatePattern({ "table/schema": "private" }, tableCreate)).toBe(
        false,
      );
    });

    test("path with array value checks inclusion", () => {
      expect(
        evaluatePattern({ "table/schema": ["public", "private"] }, tableCreate),
      ).toBe(true);
      expect(
        evaluatePattern({ "table/schema": ["private", "auth"] }, tableCreate),
      ).toBe(false);
    });

    test("path not found returns false", () => {
      expect(evaluatePattern({ "table/schema": "public" }, roleDrop)).toBe(
        false,
      );
    });
  });

  describe("glob pattern matching", () => {
    test("*/schema matches any objectType's schema", () => {
      expect(evaluatePattern({ "*/schema": "public" }, tableCreate)).toBe(true);
      expect(evaluatePattern({ "*/schema": "private" }, viewAlter)).toBe(true);
      expect(evaluatePattern({ "*/schema": "public" }, viewAlter)).toBe(false);
    });

    test("*/owner matches across object types", () => {
      expect(evaluatePattern({ "*/owner": "postgres" }, tableCreate)).toBe(
        true,
      );
      expect(evaluatePattern({ "*/owner": "admin" }, viewAlter)).toBe(true);
    });

    test("*/schema does not match objectTypes without schema", () => {
      expect(evaluatePattern({ "*/schema": "anything" }, roleDrop)).toBe(false);
    });

    test("*/name matches role/name", () => {
      expect(evaluatePattern({ "*/name": "admin" }, roleDrop)).toBe(true);
    });

    test("glob with array value", () => {
      expect(
        evaluatePattern({ "*/schema": ["public", "private"] }, tableCreate),
      ).toBe(true);
    });
  });

  describe("boolean matching", () => {
    test("matches boolean value", () => {
      expect(
        evaluatePattern({ "table/is_partition": false }, tableCreate),
      ).toBe(true);
      expect(evaluatePattern({ "table/is_partition": true }, tableCreate)).toBe(
        false,
      );
    });
  });

  describe("regex matching", () => {
    test("regex on string value", () => {
      expect(
        evaluatePattern(
          { "table/name": { op: "regex", value: "^t" } },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { "table/name": { op: "regex", value: "^z" } },
          tableCreate,
        ),
      ).toBe(false);
    });

    test("regex with array of patterns", () => {
      expect(
        evaluatePattern(
          { "table/name": { op: "regex", value: ["^z", "^t"] } },
          tableCreate,
        ),
      ).toBe(true);
    });

    test("regex on array value (requires)", () => {
      expect(
        evaluatePattern(
          { requires: { op: "regex", value: "^schema:" } },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { requires: { op: "regex", value: "^type:auth\\." } },
          viewAlter,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { requires: { op: "regex", value: "^type:auth\\." } },
          tableCreate,
        ),
      ).toBe(false);
    });
  });

  describe("array value matching (requires/creates)", () => {
    test("string match against array checks any element", () => {
      expect(evaluatePattern({ requires: "schema:public" }, tableCreate)).toBe(
        true,
      );
      expect(evaluatePattern({ requires: "schema:private" }, tableCreate)).toBe(
        false,
      );
    });

    test("array match against array checks intersection", () => {
      expect(
        evaluatePattern(
          { requires: ["schema:public", "schema:other"] },
          tableCreate,
        ),
      ).toBe(true);
    });

    test("no match on empty requires", () => {
      expect(evaluatePattern({ requires: "schema:public" }, roleDrop)).toBe(
        false,
      );
    });
  });

  describe("member/grantee matching", () => {
    test("member match", () => {
      expect(evaluatePattern({ member: "app_user" }, membershipChange)).toBe(
        true,
      );
      expect(evaluatePattern({ member: "other_user" }, membershipChange)).toBe(
        false,
      );
    });

    test("member not present returns false", () => {
      expect(evaluatePattern({ member: "app_user" }, tableCreate)).toBe(false);
    });
  });

  describe("composition patterns", () => {
    test("not negates a pattern", () => {
      expect(
        evaluatePattern({ not: { objectType: "table" } }, tableCreate),
      ).toBe(false);
      expect(
        evaluatePattern({ not: { objectType: "view" } }, tableCreate),
      ).toBe(true);
    });

    test("and requires all to match", () => {
      expect(
        evaluatePattern(
          { and: [{ objectType: "table" }, { operation: "create" }] },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { and: [{ objectType: "table" }, { operation: "drop" }] },
          tableCreate,
        ),
      ).toBe(false);
    });

    test("or requires any to match", () => {
      expect(
        evaluatePattern(
          { or: [{ objectType: "table" }, { objectType: "view" }] },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { or: [{ objectType: "role" }, { objectType: "view" }] },
          tableCreate,
        ),
      ).toBe(false);
    });

    test("nested composition", () => {
      expect(
        evaluatePattern(
          { not: { or: [{ objectType: "role" }, { objectType: "view" }] } },
          tableCreate,
        ),
      ).toBe(true);
    });

    test("composition with glob patterns", () => {
      expect(
        evaluatePattern(
          { not: { "*/schema": ["auth", "extensions"] } },
          tableCreate,
        ),
      ).toBe(true);
    });
  });

  describe("combined path + bare keys", () => {
    test("objectType and path key AND together", () => {
      expect(
        evaluatePattern(
          { objectType: "table", "table/is_partition": false },
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { objectType: "table", "table/is_partition": true },
          tableCreate,
        ),
      ).toBe(false);
    });
  });

  describe("cascade property", () => {
    test("cascade is ignored and does not affect match", () => {
      expect(
        evaluatePattern(
          { objectType: "table", cascade: true } as Parameters<
            typeof evaluatePattern
          >[0],
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { objectType: "table", cascade: false } as Parameters<
            typeof evaluatePattern
          >[0],
          tableCreate,
        ),
      ).toBe(true);
      expect(
        evaluatePattern(
          { not: { "*/schema": "auth" }, cascade: true },
          tableCreate,
        ),
      ).toBe(true);
    });
  });
});

describe("compileFilterDSL", () => {
  test("returns a function that evaluates the pattern", () => {
    const filter = compileFilterDSL({ objectType: "table" });
    expect(typeof filter).toBe("function");
    expect(filter(tableCreate)).toBe(true);
    expect(filter(roleDrop)).toBe(false);
  });

  test("works with composition patterns", () => {
    const filter = compileFilterDSL({
      or: [{ objectType: "table" }, { objectType: "role" }],
    });
    expect(filter(tableCreate)).toBe(true);
    expect(filter(roleDrop)).toBe(true);
    expect(filter(viewAlter)).toBe(false);
  });

  test("works with glob-based patterns", () => {
    const filter = compileFilterDSL({
      "*/schema": "public",
    });
    expect(filter(tableCreate)).toBe(true);
    expect(filter(viewAlter)).toBe(false);
  });
});
