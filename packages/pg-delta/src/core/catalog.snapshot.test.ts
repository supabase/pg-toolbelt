import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "./catalog.snapshot.ts";
import { Aggregate } from "./objects/aggregate/aggregate.model.ts";
import { Procedure } from "./objects/procedure/procedure.model.ts";
import { RlsPolicy } from "./objects/rls-policy/rls-policy.model.ts";
import { Role } from "./objects/role/role.model.ts";
import { Schema } from "./objects/schema/schema.model.ts";
import { Sequence } from "./objects/sequence/sequence.model.ts";
import { Table } from "./objects/table/table.model.ts";

function emptyCatalogProps() {
  return {
    aggregates: {},
    collations: {},
    compositeTypes: {},
    domains: {},
    enums: {},
    extensions: {},
    procedures: {},
    indexes: {},
    materializedViews: {},
    subscriptions: {},
    publications: {},
    rlsPolicies: {},
    roles: {},
    schemas: {},
    sequences: {},
    tables: {},
    triggers: {},
    eventTriggers: {},
    rules: {},
    ranges: {},
    views: {},
    foreignDataWrappers: {},
    servers: {},
    userMappings: {},
    foreignTables: {},
    depends: [],
    indexableObjects: {},
    version: 160000,
    currentUser: "postgres",
  };
}

describe("catalog snapshot serde", () => {
  test("round-trip on empty catalog", async () => {
    const original = await createEmptyCatalog(160000, "postgres");
    const snapshot = serializeCatalog(original);
    const json = stringifyCatalogSnapshot(snapshot);
    const deserialized = deserializeCatalog(JSON.parse(json));

    expect(deserialized.version).toBe(original.version);
    expect(deserialized.currentUser).toBe(original.currentUser);
    expect(Object.keys(deserialized.schemas)).toEqual(
      Object.keys(original.schemas),
    );

    const origSchema = original.schemas["schema:public"];
    const deserSchema = deserialized.schemas["schema:public"];
    expect(deserSchema.name).toBe(origSchema.name);
    expect(deserSchema.owner).toBe(origSchema.owner);
    expect(deserSchema.comment).toBe(origSchema.comment);
    expect(deserSchema.privileges).toEqual(origSchema.privileges);
  });

  test("round-trip preserves Sequence BigInt fields", () => {
    const seq = new Sequence({
      schema: "public",
      name: "my_seq",
      data_type: "bigint",
      start_value: 1,
      minimum_value: BigInt("-9223372036854775808"),
      maximum_value: BigInt("9223372036854775807"),
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: null,
      owned_by_table: null,
      owned_by_column: null,
      comment: null,
      privileges: [],
      owner: "postgres",
    });

    const catalog = new Catalog({
      ...emptyCatalogProps(),
      sequences: { [seq.stableId]: seq },
    });

    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);
    const deserialized = deserializeCatalog(JSON.parse(json));

    const deserSeq = deserialized.sequences[seq.stableId];
    expect(deserSeq).toBeDefined();
    expect(deserSeq.minimum_value).toBe(BigInt("-9223372036854775808"));
    expect(deserSeq.maximum_value).toBe(BigInt("9223372036854775807"));
    expect(typeof deserSeq.minimum_value).toBe("bigint");
    expect(typeof deserSeq.maximum_value).toBe("bigint");
  });

  test("round-trip preserves Aggregate identity_arguments mapping", () => {
    const agg = new Aggregate({
      schema: "public",
      name: "my_agg",
      identity_arguments: "  integer, text  ",
      kind: "a",
      aggkind: "n",
      num_direct_args: 0,
      return_type: "integer",
      return_type_schema: null,
      parallel_safety: "u",
      is_strict: false,
      transition_function: "my_sfunc",
      state_data_type: "integer",
      state_data_type_schema: null,
      state_data_space: 0,
      final_function: null,
      final_function_extra_args: false,
      final_function_modify: null,
      combine_function: null,
      serial_function: null,
      deserial_function: null,
      initial_condition: "0",
      moving_transition_function: null,
      moving_inverse_function: null,
      moving_state_data_type: null,
      moving_state_data_type_schema: null,
      moving_state_data_space: null,
      moving_final_function: null,
      moving_final_function_extra_args: false,
      moving_final_function_modify: null,
      moving_initial_condition: null,
      sort_operator: null,
      argument_count: 2,
      argument_default_count: 0,
      argument_names: null,
      argument_types: ["integer", "text"],
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      owner: "postgres",
      comment: null,
      privileges: [],
    });

    const catalog = new Catalog({
      ...emptyCatalogProps(),
      aggregates: { [agg.stableId]: agg },
    });

    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);
    const deserialized = deserializeCatalog(JSON.parse(json));

    const deserAgg = deserialized.aggregates[agg.stableId];
    expect(deserAgg).toBeDefined();
    expect(deserAgg.identityArguments).toBe("integer, text");
  });

  test("round-trip preserves depends array", () => {
    const table = new Table({
      schema: "public",
      name: "my_table",
      owner: "postgres",
      comment: null,
      privileges: [],
      columns: [],
      constraints: [],
      persistence: "p",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      partition_by: null,
      parent_schema: null,
      parent_name: null,
    });

    const publicSchema = new Schema({
      name: "public",
      owner: "pg_database_owner",
      comment: "standard public schema",
      privileges: [],
    });

    const depends = [
      {
        dependent_stable_id: table.stableId,
        referenced_stable_id: publicSchema.stableId,
        deptype: "n" as const,
      },
    ];

    const catalog = new Catalog({
      ...emptyCatalogProps(),
      schemas: { [publicSchema.stableId]: publicSchema },
      tables: { [table.stableId]: table },
      indexableObjects: { [table.stableId]: table },
      depends,
    });

    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);
    const deserialized = deserializeCatalog(JSON.parse(json));

    expect(deserialized.depends).toEqual(depends);
  });

  test("round-trip preserves indexableObjects from tables and materialized views", () => {
    const table = new Table({
      schema: "public",
      name: "tbl",
      owner: "postgres",
      comment: null,
      privileges: [],
      columns: [],
      constraints: [],
      persistence: "p",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      partition_by: null,
      parent_schema: null,
      parent_name: null,
    });

    const catalog = new Catalog({
      ...emptyCatalogProps(),
      tables: { [table.stableId]: table },
      indexableObjects: { [table.stableId]: table },
    });

    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);
    const deserialized = deserializeCatalog(JSON.parse(json));

    expect(Object.keys(deserialized.indexableObjects)).toEqual([
      table.stableId,
    ]);
  });

  test("deserializeCatalog rejects invalid data", () => {
    expect(() => deserializeCatalog({})).toThrow();
    expect(() => deserializeCatalog("not json")).toThrow();
    expect(() => deserializeCatalog(null)).toThrow();
    expect(() =>
      deserializeCatalog({ version: "not-a-number", currentUser: "x" }),
    ).toThrow();
  });

  test("deserializeCatalog rejects missing required fields", () => {
    expect(() =>
      deserializeCatalog({
        version: 1,
        currentUser: "x",
      }),
    ).toThrow();
  });

  test("createPlan accepts Catalog directly as source", async () => {
    const { createPlan } = await import("./plan/create.ts");

    const source = await createEmptyCatalog(160000, "postgres");
    const target = await createEmptyCatalog(160000, "postgres");

    const result = await createPlan(source, target);
    expect(result).toBeNull();
  });

  test("createPlan with null source produces plan when target has objects", async () => {
    const { createPlan } = await import("./plan/create.ts");

    const publicSchema = new Schema({
      name: "public",
      owner: "pg_database_owner",
      comment: "standard public schema",
      privileges: [],
    });

    const mySchema = new Schema({
      name: "myschema",
      owner: "postgres",
      comment: null,
      privileges: [],
    });

    const target = new Catalog({
      ...emptyCatalogProps(),
      schemas: {
        [publicSchema.stableId]: publicSchema,
        [mySchema.stableId]: mySchema,
      },
    });

    const result = await createPlan(null, target);
    expect(result).not.toBeNull();
    expect(result?.plan.statements.length).toBeGreaterThan(0);
  });

  test("createPlan with filter DSL without cascade keeps dependents of excluded changes", async () => {
    const { createPlan } = await import("./plan/create.ts");

    const authSchema = new Schema({
      name: "auth",
      owner: "postgres",
      comment: null,
      privileges: [],
    });
    const publicSchema = new Schema({
      name: "public",
      owner: "postgres",
      comment: null,
      privileges: [],
    });
    const postgresRole = new Role({
      name: "postgres",
      is_superuser: true,
      can_inherit: true,
      can_create_roles: true,
      can_create_databases: true,
      can_login: true,
      can_replicate: true,
      connection_limit: null,
      can_bypass_rls: true,
      config: null,
      comment: null,
      members: [],
      default_privileges: [],
    });
    const authUidProc = new Procedure({
      schema: "auth",
      name: "uid",
      kind: "f",
      return_type: "uuid",
      return_type_schema: "pg_catalog",
      language: "sql",
      security_definer: false,
      volatility: "s",
      parallel_safety: "s",
      is_strict: true,
      leakproof: false,
      returns_set: false,
      argument_count: 0,
      argument_default_count: 0,
      argument_names: null,
      argument_types: null,
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      source_code: null,
      definition: "CREATE FUNCTION auth.uid() RETURNS uuid ...",
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "postgres",
      execution_cost: 0,
      result_rows: 0,
      comment: null,
      privileges: [],
    });
    const accountsTable = new Table({
      schema: "public",
      name: "accounts",
      owner: "postgres",
      comment: null,
      privileges: [],
      columns: [],
      constraints: [],
      persistence: "p",
      row_security: true,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      partition_by: null,
      parent_schema: null,
      parent_name: null,
    });
    const accountsPolicy = new RlsPolicy({
      schema: "public",
      name: "accounts_select_policy",
      table_name: "accounts",
      command: "r",
      permissive: true,
      roles: ["authenticated"],
      using_expression: "auth.uid() = user_id",
      with_check_expression: null,
      owner: "postgres",
      comment: null,
    });

    const target = new Catalog({
      ...emptyCatalogProps(),
      roles: { [postgresRole.stableId]: postgresRole },
      schemas: {
        [authSchema.stableId]: authSchema,
        [publicSchema.stableId]: publicSchema,
      },
      procedures: { [authUidProc.stableId]: authUidProc },
      tables: { [accountsTable.stableId]: accountsTable },
      rlsPolicies: { [accountsPolicy.stableId]: accountsPolicy },
      indexableObjects: { [accountsTable.stableId]: accountsTable },
      depends: [
        {
          dependent_stable_id: accountsPolicy.stableId,
          referenced_stable_id: authUidProc.stableId,
          deptype: "n",
        },
      ],
    });

    // Filter out auth schema (no cascade): procedure is excluded but policy stays
    const resultNoCascade = await createPlan(null, target, {
      filter: { not: { schema: ["auth"] } },
    });
    expect(resultNoCascade).not.toBeNull();
    if (resultNoCascade) {
      const policyChangesNoCascade = resultNoCascade.sortedChanges.filter(
        (c) => c.objectType === "rls_policy",
      );
      expect(policyChangesNoCascade.length).toBe(1);
    }

    // Filter out auth schema with cascade: true: policy is also excluded (depends on auth.uid())
    const resultCascade = await createPlan(null, target, {
      filter: { not: { schema: ["auth"] }, cascade: true },
    });
    expect(resultCascade).not.toBeNull();
    if (resultCascade) {
      const policyChangesCascade = resultCascade.sortedChanges.filter(
        (c) => c.objectType === "rls_policy",
      );
      expect(policyChangesCascade.length).toBe(0);
    }
  });
});
