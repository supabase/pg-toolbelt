import { describe, expect, test } from "bun:test";
import {
  constraintKeyColumns,
  extractNameParts,
  extractStringValue,
  keyRefForTableColumns,
  objectFromNameParts,
  objectKindFromObjType,
  relationFromRangeVarNode,
  typeFromTypeNameNode,
} from "../src/extract/shared-refs";

describe("extractStringValue", () => {
  test("returns undefined for null or non-object", () => {
    expect(extractStringValue(null)).toBeUndefined();
    expect(extractStringValue(undefined)).toBeUndefined();
    expect(extractStringValue(42)).toBeUndefined();
  });

  test("returns undefined when node has no String or sval is not string", () => {
    expect(extractStringValue({})).toBeUndefined();
    expect(extractStringValue({ String: {} })).toBeUndefined();
    expect(extractStringValue({ String: { sval: 123 } })).toBeUndefined();
  });

  test("returns sval when String.sval is string", () => {
    expect(extractStringValue({ String: { sval: "public" } })).toBe("public");
  });
});

describe("extractNameParts", () => {
  test("returns empty array for non-array input", () => {
    expect(extractNameParts(null)).toEqual([]);
    expect(extractNameParts({})).toEqual([]);
  });

  test("returns only string values from parts", () => {
    const parts = [{ String: { sval: "a" } }, {}, { String: { sval: "b" } }];
    expect(extractNameParts(parts)).toEqual(["a", "b"]);
  });
});

describe("objectKindFromObjType", () => {
  test("returns null for unknown objType", () => {
    expect(objectKindFromObjType("UNKNOWN")).toBeNull();
    expect(objectKindFromObjType("OBJECT_FOO")).toBeNull();
    expect(objectKindFromObjType(null)).toBeNull();
  });

  test("returns kind for known objTypes", () => {
    expect(objectKindFromObjType("OBJECT_TABLE")).toBe("table");
    expect(objectKindFromObjType("OBJECT_FUNCTION")).toBe("function");
    expect(objectKindFromObjType("OBJECT_VIEW")).toBe("view");
  });
});

describe("objectFromNameParts", () => {
  test("returns null for empty parts", () => {
    expect(objectFromNameParts("table", [])).toBeNull();
  });

  test("returns null for trigger/policy when objectName or relationName missing", () => {
    expect(objectFromNameParts("trigger", ["rel", ""])).toBeNull();
    expect(objectFromNameParts("policy", ["", "policy_name"])).toBeNull();
  });

  test("returns ref for single-part schema-like kinds", () => {
    const ref = objectFromNameParts("schema", ["app"], "public");
    expect(ref).toEqual({ kind: "schema", name: "app" });
  });

  test("returns ref for single-part table with fallback schema", () => {
    const ref = objectFromNameParts("table", ["users"], "public");
    expect(ref).toEqual({ kind: "table", name: "users", schema: "public" });
  });

  test("returns ref for multi-part (schema.name)", () => {
    const ref = objectFromNameParts("table", ["app", "users"], "public");
    expect(ref).toEqual({ kind: "table", name: "users", schema: "app" });
  });

  test("trigger and policy use relation.objectName identity so COMMENT ON resolves to CREATE", () => {
    // COMMENT ON TRIGGER name on relation → parts [schema?, relation, triggerName]
    const triggerRef = objectFromNameParts(
      "trigger",
      ["auth", "users", "initialise_auth_users_email"],
      "public",
    );
    expect(triggerRef).toEqual({
      kind: "trigger",
      schema: "auth",
      name: "users.initialise_auth_users_email",
    });

    // COMMENT ON POLICY name on relation → same shape
    const policyRef = objectFromNameParts(
      "policy",
      ["auth", "users", "users_select_policy"],
      "public",
    );
    expect(policyRef).toEqual({
      kind: "policy",
      schema: "auth",
      name: "users.users_select_policy",
    });

    // Two parts only (no schema) → schema from fallback
    const triggerNoSchema = objectFromNameParts(
      "trigger",
      ["my_table", "my_trigger"],
      "public",
    );
    expect(triggerNoSchema).toEqual({
      kind: "trigger",
      name: "my_table.my_trigger",
      schema: "public",
    });
  });
});

describe("keyRefForTableColumns", () => {
  test("returns null for null tableRef or empty columnNames", () => {
    expect(keyRefForTableColumns(null, ["id"])).toBeNull();
    expect(
      keyRefForTableColumns(
        { kind: "table", name: "users", schema: "public" },
        [],
      ),
    ).toBeNull();
  });

  test("returns constraint ref with signature", () => {
    const ref = keyRefForTableColumns(
      { kind: "table", name: "users", schema: "public" },
      ["id"],
    );
    expect(ref).toEqual({
      kind: "constraint",
      name: "users",
      schema: "public",
      signature: "(id)",
    });
  });
});

describe("constraintKeyColumns", () => {
  test("returns keys when present", () => {
    expect(
      constraintKeyColumns({ keys: [{ String: { sval: "id" } }] }),
    ).toEqual(["id"]);
  });

  test("returns pk_attrs when keys empty", () => {
    expect(
      constraintKeyColumns({
        keys: [],
        pk_attrs: [{ String: { sval: "pk" } }],
      }),
    ).toEqual(["pk"]);
  });

  test("returns fallbackColumnName when keys and pk_attrs empty", () => {
    expect(constraintKeyColumns({}, "fallback_col")).toEqual(["fallback_col"]);
  });

  test("returns empty array when all empty and no fallback", () => {
    expect(constraintKeyColumns({})).toEqual([]);
  });
});

describe("relationFromRangeVarNode", () => {
  test("returns null for null or missing relname", () => {
    expect(relationFromRangeVarNode(null)).toBeNull();
    expect(relationFromRangeVarNode({})).toBeNull();
    expect(relationFromRangeVarNode({ relname: 123 })).toBeNull();
  });

  test("returns ref with DEFAULT_SCHEMA when schemaname missing", () => {
    const ref = relationFromRangeVarNode({ relname: "users" });
    expect(ref).toEqual({ kind: "table", name: "users", schema: "public" });
  });

  test("returns ref with schemaname when present", () => {
    const ref = relationFromRangeVarNode({
      relname: "users",
      schemaname: "app",
    });
    expect(ref).toEqual({ kind: "table", name: "users", schema: "app" });
  });
});

describe("typeFromTypeNameNode", () => {
  test("returns null for null or missing names", () => {
    expect(typeFromTypeNameNode(null)).toBeNull();
    expect(typeFromTypeNameNode({})).toBeNull();
  });

  test("returns type ref from names", () => {
    const ref = typeFromTypeNameNode({
      names: [{ String: { sval: "app" } }, { String: { sval: "user_role" } }],
    });
    expect(ref).toEqual({
      kind: "type",
      name: "user_role",
      schema: "app",
    });
  });
});
