import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { ForeignTable } from "../foreign-table.model.ts";
import { CreateForeignTable } from "./foreign-table.create.ts";

describe("foreign-table", () => {
  test("create basic", async () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer) SERVER test_server",
    );
  });

  test("create with multiple columns", async () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: null,
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
        {
          name: "name",
          position: 2,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer, name text) SERVER test_server",
    );
  });

  test("create with options", async () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: ["schema_name", "remote_schema", "table_name", "remote_table"],
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer) SERVER test_server OPTIONS (schema_name 'remote_schema', table_name 'remote_table')",
    );
  });

  test("create with all properties", async () => {
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "test_table",
      owner: "test",
      server: "test_server",
      options: ["schema_name", "remote_schema", "table_name", "remote_table"],
      comment: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
        {
          name: "name",
          position: 2,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN TABLE public.test_table (id integer, name text) SERVER test_server OPTIONS (schema_name 'remote_schema', table_name 'remote_table')",
    );
  });

  test("redacts sensitive option values to prevent secret leakage (CLI-1467)", async () => {
    // Foreign tables don't usually carry credentials, but a wrapper is
    // free to define one — make sure the redaction policy still applies.
    const foreignTable = new ForeignTable({
      schema: "public",
      name: "leaky_table",
      owner: "postgres",
      server: "test_server",
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      options: [
        "schema_name",
        "remote_schema",
        "api_key",
        "leaked-api-key",
        "password",
        "table-shared-secret",
      ],
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignTable({
      foreignTable,
    });

    await assertValidSql(change.serialize());

    const sql = change.serialize();
    expect(sql).not.toContain("leaked-api-key");
    expect(sql).not.toContain("table-shared-secret");
    expect(sql).toContain("schema_name 'remote_schema'");
    expect(sql).toContain("api_key '__OPTION_API_KEY__'");
    expect(sql).toContain("password '__OPTION_PASSWORD__'");
  });
});
