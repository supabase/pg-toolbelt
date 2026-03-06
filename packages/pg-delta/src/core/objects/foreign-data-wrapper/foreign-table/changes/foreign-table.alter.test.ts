import { describe, expect, test } from "bun:test";
import {
  ForeignTable,
  type ForeignTableProps,
} from "../foreign-table.model.ts";
import {
  AlterForeignTableAddColumn,
  AlterForeignTableAlterColumnDropDefault,
  AlterForeignTableAlterColumnDropNotNull,
  AlterForeignTableAlterColumnSetDefault,
  AlterForeignTableAlterColumnSetNotNull,
  AlterForeignTableAlterColumnType,
  AlterForeignTableChangeOwner,
  AlterForeignTableDropColumn,
  AlterForeignTableSetOptions,
} from "./foreign-table.alter.ts";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";

describe.concurrent("foreign-table", () => {
  describe("alter", () => {
    const baseTableProps: ForeignTableProps = {
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
    };

    test("change owner", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableChangeOwner({
        foreignTable,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OWNER TO new_owner",
      );
    });

    test("add column", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
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
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text",
      );
    });

    test("add column with NOT NULL", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
          name: "name",
          position: 2,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text NOT NULL",
      );
    });

    test("add column with DEFAULT", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
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
          default: "'default_value'",
          comment: null,
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text DEFAULT 'default_value'",
      );
    });

    test("add column with NOT NULL and DEFAULT", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAddColumn({
        foreignTable,
        column: {
          name: "name",
          position: 2,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: "'default_value'",
          comment: null,
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ADD COLUMN name text NOT NULL DEFAULT 'default_value'",
      );
    });

    test("drop column", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableDropColumn({
        foreignTable,
        columnName: "id",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table DROP COLUMN id",
      );
    });

    test("alter column type", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnType({
        foreignTable,
        columnName: "id",
        dataType: "bigint",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id TYPE bigint",
      );
    });

    test("alter column set default", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnSetDefault({
        foreignTable,
        columnName: "id",
        defaultValue: "0",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id SET DEFAULT 0",
      );
    });

    test("alter column drop default", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnDropDefault({
        foreignTable,
        columnName: "id",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id DROP DEFAULT",
      );
    });

    test("alter column set not null", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnSetNotNull({
        foreignTable,
        columnName: "id",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id SET NOT NULL",
      );
    });

    test("alter column drop not null", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableAlterColumnDropNotNull({
        foreignTable,
        columnName: "id",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table ALTER COLUMN id DROP NOT NULL",
      );
    });

    test("set options ADD", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [
          { action: "ADD", option: "schema_name", value: "remote_schema" },
          { action: "ADD", option: "table_name", value: "remote_table" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (ADD schema_name 'remote_schema', ADD table_name 'remote_table')",
      );
    });

    test("set options SET", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [
          { action: "SET", option: "schema_name", value: "new_schema" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (SET schema_name 'new_schema')",
      );
    });

    test("set options DROP", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [{ action: "DROP", option: "schema_name" }],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (DROP schema_name)",
      );
    });

    test("set options mixed ADD/SET/DROP", async () => {
      const foreignTable = new ForeignTable(baseTableProps);
      const change = new AlterForeignTableSetOptions({
        foreignTable,
        options: [
          { action: "ADD", option: "new_option", value: "new_value" },
          { action: "SET", option: "existing_option", value: "updated_value" },
          { action: "DROP", option: "old_option" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN TABLE public.test_table OPTIONS (ADD new_option 'new_value', SET existing_option 'updated_value', DROP old_option)",
      );
    });
  });
});
