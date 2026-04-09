import { describe, expect, test } from "bun:test";
import type { Change } from "../../change.types.ts";
import { compileSerializeDSL } from "./dsl.ts";

function makeChange(
  type: string,
  operation: string,
  serializeFn: (opts?: Record<string, unknown>) => string,
): Change {
  return {
    objectType: type,
    operation,
    scope: "object",
    schema: { name: "test" },
    serialize: serializeFn,
  } as unknown as Change;
}

describe("compileSerializeDSL", () => {
  test("matching rule applies its options", () => {
    const serializer = compileSerializeDSL([
      {
        when: { objectType: "schema", operation: "create" },
        options: { skipAuthorization: true },
      },
    ]);

    const change = makeChange("schema", "create", (opts) =>
      opts?.skipAuthorization
        ? "CREATE SCHEMA test"
        : "CREATE SCHEMA test AUTHORIZATION owner",
    );

    expect(serializer(change)).toBe("CREATE SCHEMA test");
  });

  test("no matching rule uses default serialization", () => {
    const serializer = compileSerializeDSL([
      {
        when: { objectType: "table" },
        options: { skipAuthorization: true },
      },
    ]);

    const change = makeChange("schema", "create", (opts) =>
      opts?.skipAuthorization
        ? "CREATE SCHEMA test"
        : "CREATE SCHEMA test AUTHORIZATION owner",
    );

    expect(serializer(change)).toBe("CREATE SCHEMA test AUTHORIZATION owner");
  });

  test("first matching rule wins", () => {
    const serializer = compileSerializeDSL([
      {
        when: { objectType: "schema" },
        options: { skipAuthorization: true },
      },
      {
        when: { objectType: "schema" },
        options: { skipAuthorization: false },
      },
    ]);

    const change = makeChange("schema", "create", (opts) =>
      opts?.skipAuthorization ? "WITHOUT AUTH" : "WITH AUTH",
    );

    expect(serializer(change)).toBe("WITHOUT AUTH");
  });

  test("skips non-matching first rule and applies second", () => {
    const serializer = compileSerializeDSL([
      {
        when: { objectType: "table" },
        options: { skipAuthorization: true },
      },
      {
        when: { objectType: "schema" },
        options: { skipAuthorization: false },
      },
    ]);

    const change = makeChange("schema", "create", (opts) =>
      opts?.skipAuthorization ? "WITHOUT AUTH" : "WITH AUTH",
    );

    expect(serializer(change)).toBe("WITH AUTH");
  });
});
