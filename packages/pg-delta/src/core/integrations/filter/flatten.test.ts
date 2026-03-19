import { describe, expect, test } from "bun:test";
import type { Change } from "../../change.types.ts";
import { compileGlob, flattenChange, getSchema } from "./flatten.ts";

describe("flattenChange", () => {
  test("flattens top-level scalar properties", () => {
    const change = {
      objectType: "table",
      operation: "create",
      scope: "object",
      table: { schema: "public", name: "users" },
      requires: ["schema:public"],
      creates: ["table:public.users"],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.objectType).toBe("table");
    expect(flat.operation).toBe("create");
    expect(flat.scope).toBe("object");
  });

  test("flattens array properties", () => {
    const change = {
      objectType: "table",
      operation: "create",
      scope: "object",
      table: { schema: "public", name: "users" },
      requires: ["schema:public", "role:postgres"],
      creates: ["table:public.users"],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.requires).toEqual(["schema:public", "role:postgres"]);
    expect(flat.creates).toEqual(["table:public.users"]);
  });

  test("flattens model sub-object properties with objectType prefix", () => {
    const change = {
      objectType: "table",
      operation: "create",
      scope: "object",
      table: {
        schema: "public",
        name: "users",
        owner: "postgres",
        is_partition: false,
        persistence: "p",
      },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat["table/schema"]).toBe("public");
    expect(flat["table/name"]).toBe("users");
    expect(flat["table/owner"]).toBe("postgres");
    expect(flat["table/is_partition"]).toBe(false);
    expect(flat["table/persistence"]).toBe("p");
  });

  test("includes member when present", () => {
    const change = {
      objectType: "role",
      operation: "create",
      scope: "membership",
      member: "app_user",
      role: { name: "admin" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.member).toBe("app_user");
  });

  test("includes grantee when present", () => {
    const change = {
      objectType: "table",
      operation: "create",
      scope: "privilege",
      grantee: "reader",
      table: { schema: "public", name: "users" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.grantee).toBe("reader");
  });

  test("skips nested objects", () => {
    const change = {
      objectType: "table",
      operation: "create",
      scope: "object",
      table: {
        schema: "public",
        name: "users",
        columns: [{ name: "id", type: "integer" }],
        constraints: { pk: { type: "primary_key" } },
      },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat["table/columns"]).toBeUndefined();
    expect(flat["table/constraints"]).toBeUndefined();
  });

  test("handles null model property values", () => {
    const change = {
      objectType: "procedure",
      operation: "create",
      scope: "object",
      procedure: {
        schema: "public",
        name: "my_func",
        binary_path: null,
        language: "plpgsql",
      },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat["procedure/binary_path"]).toBeNull();
    expect(flat["procedure/language"]).toBe("plpgsql");
  });

  test("defaults requires/creates/drops to empty arrays", () => {
    const change = {
      objectType: "role",
      operation: "create",
      scope: "object",
      role: { name: "admin" },
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.requires).toEqual([]);
    expect(flat.creates).toEqual([]);
    expect(flat.drops).toEqual([]);
  });

  test("normalizes schema/schema for schema changes", () => {
    const change = {
      objectType: "schema",
      operation: "create",
      scope: "object",
      schema: { name: "auth" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat["schema/name"]).toBe("auth");
    expect(flat["schema/schema"]).toBe("auth");
  });

  test("normalizes event_trigger/schema from function_schema", () => {
    const change = {
      objectType: "event_trigger",
      operation: "create",
      scope: "object",
      eventTrigger: { name: "my_trigger", function_schema: "public", function_name: "my_func" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat["event_trigger/function_schema"]).toBe("public");
    expect(flat["event_trigger/schema"]).toBe("public");
  });

  test("flattens rls_policy model properties (camelCase mapping)", () => {
    const change = {
      objectType: "rls_policy",
      operation: "create",
      scope: "object",
      policy: { schema: "public", table: "users", name: "select_policy" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat["rls_policy/schema"]).toBe("public");
    expect(flat["rls_policy/table"]).toBe("users");
    expect(flat["rls_policy/name"]).toBe("select_policy");
  });

  test("flattens all top-level scalar properties systematically", () => {
    const change = {
      objectType: "role",
      operation: "create",
      scope: "membership",
      member: "app_user",
      role: { name: "admin" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.member).toBe("app_user");
  });

  test("flattens inSchema for default_privilege changes", () => {
    const change = {
      objectType: "role",
      operation: "create",
      scope: "default_privilege",
      inSchema: "public",
      objtype: "table",
      role: { name: "admin" },
      requires: [],
    } as unknown as Change;

    const flat = flattenChange(change);
    expect(flat.inSchema).toBe("public");
    expect(flat.objtype).toBe("table");
    expect(flat["role/schema"]).toBe("public");
  });

  test("caches results (returns same reference)", () => {
    const change = {
      objectType: "table",
      operation: "create",
      scope: "object",
      table: { schema: "public", name: "t" },
      requires: [],
    } as unknown as Change;

    const flat1 = flattenChange(change);
    const flat2 = flattenChange(change);
    expect(flat1).toBe(flat2);
  });
});

describe("compileGlob", () => {
  test("exact match on bare key", () => {
    const matcher = compileGlob("objectType");
    expect(matcher("objectType")).toBe(true);
    expect(matcher("operation")).toBe(false);
    expect(matcher("table/objectType")).toBe(false);
  });

  test("exact match on path key", () => {
    const matcher = compileGlob("table/schema");
    expect(matcher("table/schema")).toBe(true);
    expect(matcher("view/schema")).toBe(false);
    expect(matcher("table/name")).toBe(false);
  });

  test("wildcard matches any single segment", () => {
    const matcher = compileGlob("*/schema");
    expect(matcher("table/schema")).toBe(true);
    expect(matcher("view/schema")).toBe(true);
    expect(matcher("aggregate/schema")).toBe(true);
    expect(matcher("schema")).toBe(false);
    expect(matcher("a/b/schema")).toBe(false);
  });

  test("does not match different segment count", () => {
    const matcher = compileGlob("*/schema");
    expect(matcher("objectType")).toBe(false);
  });
});

describe("getSchema", () => {
  test("returns schema for table", () => {
    const change = {
      objectType: "table",
      table: { schema: "public" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("public");
  });

  test("returns schema for view", () => {
    const change = {
      objectType: "view",
      view: { schema: "app" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("app");
  });

  test("returns schema for enum", () => {
    const change = {
      objectType: "enum",
      enum: { schema: "types" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("types");
  });

  test("returns schema.name for schema type", () => {
    const change = {
      objectType: "schema",
      schema: { name: "auth" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("auth");
  });

  test("returns null for role", () => {
    const change = {
      objectType: "role",
      role: { name: "admin" },
    } as unknown as Change;
    expect(getSchema(change)).toBeNull();
  });

  test("returns null for publication", () => {
    const change = {
      objectType: "publication",
      publication: { name: "pub1" },
    } as unknown as Change;
    expect(getSchema(change)).toBeNull();
  });

  test("returns null for language", () => {
    const change = {
      objectType: "language",
      language: { name: "plpgsql" },
    } as unknown as Change;
    expect(getSchema(change)).toBeNull();
  });
});
