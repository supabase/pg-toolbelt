import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import { BaseChange } from "../objects/base.change.ts";
import type { ColumnProps } from "../objects/base.model.ts";
import { AlterTableAlterColumnSetDefault } from "../objects/table/changes/table.alter.ts";
import type { Table } from "../objects/table/table.model.ts";
import { AlterEnumAddValue } from "../objects/type/enum/changes/enum.alter.ts";
import { Enum } from "../objects/type/enum/enum.model.ts";
import { buildExecutionPlan } from "./execution.ts";

describe("buildExecutionPlan", () => {
  test("splits after enum values before subsequent statements", () => {
    const userRole = createEnum(["admin", "user", "store"]);
    const column = createEnumColumn("'store'::public.user_role");

    const execution = buildExecutionPlan([
      new AlterEnumAddValue({
        enum: userRole,
        newValue: "store",
        position: { after: "user" },
      }),
      new AlterTableAlterColumnSetDefault({
        table: createTable(column),
        column,
      }),
    ]);

    expect(execution.units).toHaveLength(2);
    expect(execution.units[0].statements).toHaveLength(1);
    expect(execution.units[1].reason).toBe("enum_value_visibility");
    expect(execution.units[1].transactionMode).toBe("transactional");
  });

  test("keeps newly added enum values in one unit when nothing uses them", () => {
    const userRole = createEnum(["admin", "user", "store"]);

    const execution = buildExecutionPlan([
      new AlterEnumAddValue({
        enum: userRole,
        newValue: "store",
        position: { after: "user" },
      }),
    ]);

    expect(execution.units).toHaveLength(1);
    expect(execution.units[0].reason).toBe("default");
  });

  test("groups multiple enum additions before a dependent consumer", () => {
    const userRole = createEnum(["admin", "user", "store", "auditor"]);
    const column = createEnumColumn("'auditor'::public.user_role");

    const execution = buildExecutionPlan([
      new AlterEnumAddValue({
        enum: userRole,
        newValue: "store",
        position: { after: "user" },
      }),
      new AlterEnumAddValue({
        enum: userRole,
        newValue: "auditor",
        position: { after: "store" },
      }),
      new AlterTableAlterColumnSetDefault({
        table: createTable(column),
        column,
      }),
    ]);

    expect(execution.units).toHaveLength(2);
    expect(execution.units[0].statements).toMatchInlineSnapshot(`
      [
        "ALTER TYPE public.user_role ADD VALUE 'store' AFTER 'user'",
        "ALTER TYPE public.user_role ADD VALUE 'auditor' AFTER 'store'",
      ]
    `);
  });

  test("splits after enum values before opaque later statements", () => {
    const userRole = createEnum(["admin", "user", "store"]);

    const execution = buildExecutionPlan([
      new AlterEnumAddValue({
        enum: userRole,
        newValue: "store",
        position: { after: "user" },
      }),
      new OpaqueEnumConsumerChange() as unknown as Change,
    ]);

    expect(execution.units).toHaveLength(2);
    expect(execution.units[1].reason).toBe("enum_value_visibility");
    expect(execution.units[1].statements[0]).toBe(
      "CREATE VIEW public.store_profiles AS SELECT 'store'::public.user_role AS role",
    );
  });

  test("puts non-transactional statements in their own unit", () => {
    const userRole = createEnum(["admin", "user", "store"]);

    const execution = buildExecutionPlan([
      new AlterEnumAddValue({
        enum: userRole,
        newValue: "store",
        position: { after: "user" },
      }),
      new NonTransactionalChange() as unknown as Change,
      new OpaqueEnumConsumerChange() as unknown as Change,
    ]);

    expect(execution.units).toMatchInlineSnapshot(`
      [
        {
          "reason": "default",
          "statements": [
            "ALTER TYPE public.user_role ADD VALUE 'store' AFTER 'user'",
          ],
          "transactionMode": "transactional",
        },
        {
          "reason": "non_transactional",
          "statements": [
            "CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)",
          ],
          "transactionMode": "none",
        },
        {
          "reason": "default",
          "statements": [
            "CREATE VIEW public.store_profiles AS SELECT 'store'::public.user_role AS role",
          ],
          "transactionMode": "transactional",
        },
      ]
    `);
  });

  test("routes SET ROLE and check_function_bodies into session statements, not units", () => {
    const execution = buildExecutionPlan(
      [new ProcedureChange() as unknown as Change],
      { role: "app_owner" },
    );

    expect(execution.sessionStatements).toEqual([
      'SET ROLE "app_owner"',
      "SET check_function_bodies = false",
    ]);
    expect(execution.units).toHaveLength(1);
    expect(execution.units[0].statements).toEqual([
      "CREATE PROCEDURE public.noop() LANGUAGE sql AS $$ SELECT 1 $$",
    ]);
  });
});

class NonTransactionalChange extends BaseChange {
  readonly operation = "create";
  readonly objectType = "index";
  readonly scope = "object";

  override get nonTransactional() {
    return true;
  }

  serialize(): string {
    return "CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)";
  }
}

class OpaqueEnumConsumerChange extends BaseChange {
  readonly operation = "create";
  readonly objectType = "view";
  readonly scope = "object";

  serialize(): string {
    return "CREATE VIEW public.store_profiles AS SELECT 'store'::public.user_role AS role";
  }
}

class ProcedureChange extends BaseChange {
  readonly operation = "create";
  readonly objectType = "procedure";
  readonly scope = "object";

  serialize(): string {
    return "CREATE PROCEDURE public.noop() LANGUAGE sql AS $$ SELECT 1 $$";
  }
}

function createEnum(labels: string[]): Enum {
  return new Enum({
    schema: "public",
    name: "user_role",
    owner: "postgres",
    labels: labels.map((label, index) => ({
      label,
      sort_order: index + 1,
    })),
    comment: null,
    privileges: [],
  });
}

function createEnumColumn(defaultValue: string): ColumnProps {
  return {
    name: "role",
    position: 1,
    data_type: "USER-DEFINED",
    data_type_str: "public.user_role",
    is_custom_type: true,
    custom_type_type: "e",
    custom_type_category: "E",
    custom_type_schema: "public",
    custom_type_name: "user_role",
    not_null: false,
    is_identity: false,
    is_identity_always: false,
    is_generated: false,
    collation: null,
    default: defaultValue,
    comment: null,
  };
}

function createTable(column: ColumnProps): Table {
  return {
    schema: "public",
    name: "profiles",
    stableId: "table:public.profiles",
    columns: [column],
  } as unknown as Table;
}
