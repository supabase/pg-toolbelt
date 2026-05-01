import { describe, expect, test } from "bun:test";
import type { Change } from "./change.types.ts";
import { getSchema } from "./change-utils.ts";

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
