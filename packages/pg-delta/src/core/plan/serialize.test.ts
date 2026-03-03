import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import { getObjectName, getObjectSchema, getParentInfo } from "./serialize.ts";

describe("getObjectName", () => {
  const cases: [string, unknown, string][] = [
    [
      "aggregate",
      { objectType: "aggregate", aggregate: { name: "my_agg" } },
      "my_agg",
    ],
    [
      "collation",
      { objectType: "collation", collation: { name: "my_coll" } },
      "my_coll",
    ],
    [
      "composite_type",
      { objectType: "composite_type", compositeType: { name: "my_comp" } },
      "my_comp",
    ],
    [
      "domain",
      { objectType: "domain", domain: { name: "my_domain" } },
      "my_domain",
    ],
    ["enum", { objectType: "enum", enum: { name: "my_enum" } }, "my_enum"],
    [
      "event_trigger",
      { objectType: "event_trigger", eventTrigger: { name: "my_evt" } },
      "my_evt",
    ],
    [
      "extension",
      { objectType: "extension", extension: { name: "my_ext" } },
      "my_ext",
    ],
    [
      "foreign_data_wrapper",
      {
        objectType: "foreign_data_wrapper",
        foreignDataWrapper: { name: "my_fdw" },
      },
      "my_fdw",
    ],
    [
      "foreign_table",
      { objectType: "foreign_table", foreignTable: { name: "my_ft" } },
      "my_ft",
    ],
    ["index", { objectType: "index", index: { name: "my_idx" } }, "my_idx"],
    [
      "language",
      { objectType: "language", language: { name: "plpgsql" } },
      "plpgsql",
    ],
    [
      "materialized_view",
      { objectType: "materialized_view", materializedView: { name: "my_mv" } },
      "my_mv",
    ],
    [
      "procedure",
      { objectType: "procedure", procedure: { name: "my_proc" } },
      "my_proc",
    ],
    [
      "publication",
      { objectType: "publication", publication: { name: "my_pub" } },
      "my_pub",
    ],
    ["range", { objectType: "range", range: { name: "my_range" } }, "my_range"],
    [
      "rls_policy",
      { objectType: "rls_policy", policy: { name: "my_policy" } },
      "my_policy",
    ],
    ["role", { objectType: "role", role: { name: "my_role" } }, "my_role"],
    ["rule", { objectType: "rule", rule: { name: "my_rule" } }, "my_rule"],
    [
      "schema",
      { objectType: "schema", schema: { name: "my_schema" } },
      "my_schema",
    ],
    [
      "sequence",
      { objectType: "sequence", sequence: { name: "my_seq" } },
      "my_seq",
    ],
    [
      "server",
      { objectType: "server", server: { name: "my_server" } },
      "my_server",
    ],
    [
      "subscription",
      { objectType: "subscription", subscription: { name: "my_sub" } },
      "my_sub",
    ],
    ["table", { objectType: "table", table: { name: "my_table" } }, "my_table"],
    [
      "trigger",
      { objectType: "trigger", trigger: { name: "my_trigger" } },
      "my_trigger",
    ],
    [
      "user_mapping",
      {
        objectType: "user_mapping",
        userMapping: { user: "alice", server: "remote" },
      },
      "alice@remote",
    ],
    ["view", { objectType: "view", view: { name: "my_view" } }, "my_view"],
  ];

  for (const [label, stub, expected] of cases) {
    test(label, () => {
      expect(getObjectName(stub as unknown as Change)).toBe(expected);
    });
  }
});

describe("getObjectSchema", () => {
  const withSchema: [string, unknown, string][] = [
    [
      "aggregate",
      { objectType: "aggregate", aggregate: { schema: "public" } },
      "public",
    ],
    [
      "collation",
      { objectType: "collation", collation: { schema: "pg_catalog" } },
      "pg_catalog",
    ],
    [
      "composite_type",
      { objectType: "composite_type", compositeType: { schema: "public" } },
      "public",
    ],
    [
      "domain",
      { objectType: "domain", domain: { schema: "public" } },
      "public",
    ],
    ["enum", { objectType: "enum", enum: { schema: "public" } }, "public"],
    [
      "extension",
      { objectType: "extension", extension: { schema: "public" } },
      "public",
    ],
    [
      "foreign_table",
      { objectType: "foreign_table", foreignTable: { schema: "public" } },
      "public",
    ],
    ["index", { objectType: "index", index: { schema: "public" } }, "public"],
    [
      "materialized_view",
      {
        objectType: "materialized_view",
        materializedView: { schema: "public" },
      },
      "public",
    ],
    [
      "procedure",
      { objectType: "procedure", procedure: { schema: "public" } },
      "public",
    ],
    ["range", { objectType: "range", range: { schema: "public" } }, "public"],
    [
      "rls_policy",
      { objectType: "rls_policy", policy: { schema: "public" } },
      "public",
    ],
    ["rule", { objectType: "rule", rule: { schema: "public" } }, "public"],
    [
      "schema",
      { objectType: "schema", schema: { name: "my_schema" } },
      "my_schema",
    ],
    [
      "sequence",
      { objectType: "sequence", sequence: { schema: "public" } },
      "public",
    ],
    ["table", { objectType: "table", table: { schema: "public" } }, "public"],
    [
      "trigger",
      { objectType: "trigger", trigger: { schema: "public" } },
      "public",
    ],
    ["view", { objectType: "view", view: { schema: "public" } }, "public"],
  ];

  for (const [label, stub, expected] of withSchema) {
    test(`${label} returns schema`, () => {
      expect(getObjectSchema(stub as unknown as Change)).toBe(expected);
    });
  }

  const withoutSchema: [string, unknown][] = [
    ["event_trigger", { objectType: "event_trigger" }],
    ["foreign_data_wrapper", { objectType: "foreign_data_wrapper" }],
    ["language", { objectType: "language" }],
    ["publication", { objectType: "publication" }],
    ["role", { objectType: "role" }],
    ["server", { objectType: "server" }],
    ["subscription", { objectType: "subscription" }],
    ["user_mapping", { objectType: "user_mapping" }],
  ];

  for (const [label, stub] of withoutSchema) {
    test(`${label} returns null`, () => {
      expect(getObjectSchema(stub as unknown as Change)).toBeNull();
    });
  }
});

describe("getParentInfo", () => {
  test("index on table", () => {
    const change = {
      objectType: "index",
      index: { table_name: "users", table_relkind: "r" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({ type: "table", name: "users" });
  });

  test("index on materialized view", () => {
    const change = {
      objectType: "index",
      index: { table_name: "user_stats", table_relkind: "m" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({
      type: "materialized_view",
      name: "user_stats",
    });
  });

  test("trigger on table", () => {
    const change = {
      objectType: "trigger",
      trigger: { table_name: "orders", table_relkind: "r" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({ type: "table", name: "orders" });
  });

  test("trigger on view", () => {
    const change = {
      objectType: "trigger",
      trigger: { table_name: "order_view", table_relkind: "v" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({ type: "view", name: "order_view" });
  });

  test("trigger on materialized view", () => {
    const change = {
      objectType: "trigger",
      trigger: { table_name: "order_mv", table_relkind: "m" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({
      type: "materialized_view",
      name: "order_mv",
    });
  });

  test("rule on table", () => {
    const change = {
      objectType: "rule",
      rule: { table_name: "items", relation_kind: "r" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({ type: "table", name: "items" });
  });

  test("rule on view", () => {
    const change = {
      objectType: "rule",
      rule: { table_name: "item_view", relation_kind: "v" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({ type: "view", name: "item_view" });
  });

  test("rule on materialized view", () => {
    const change = {
      objectType: "rule",
      rule: { table_name: "item_mv", relation_kind: "m" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({
      type: "materialized_view",
      name: "item_mv",
    });
  });

  test("rls_policy", () => {
    const change = {
      objectType: "rls_policy",
      policy: { table_name: "secrets" },
    } as unknown as Change;
    expect(getParentInfo(change)).toEqual({ type: "table", name: "secrets" });
  });

  const nullCases = [
    "table",
    "view",
    "schema",
    "sequence",
    "role",
    "extension",
  ] as const;
  for (const objectType of nullCases) {
    test(`${objectType} returns null`, () => {
      const change = { objectType } as unknown as Change;
      expect(getParentInfo(change)).toBeNull();
    });
  }
});
