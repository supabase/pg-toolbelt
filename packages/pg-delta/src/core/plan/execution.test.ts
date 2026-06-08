import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import { BaseChange } from "../objects/base.change.ts";
import type { ColumnProps } from "../objects/base.model.ts";
import { AlterTableAlterColumnSetDefault } from "../objects/table/changes/table.alter.ts";
import type { Table } from "../objects/table/table.model.ts";
import { AlterEnumAddValue } from "../objects/type/enum/changes/enum.alter.ts";
import { Enum } from "../objects/type/enum/enum.model.ts";
import { buildExecutionPlan } from "./execution.ts";

describe("buildExecutionPlan", () => {
  test("splits after enum values before subsequent statements", () => {
    const mainEnum = createEnum(["admin", "user"]);
    const branchEnum = createEnum(["admin", "user", "store"]);
    const column = createEnumColumn("'store'::public.user_role");

    const execution = buildExecutionPlan(createContext(mainEnum, branchEnum), [
      new AlterEnumAddValue({
        enum: mainEnum,
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
    expect(execution.units[1].statements[0].requiresCommittedEffects).toEqual(
      [],
    );
  });

  test("keeps newly added enum values in one unit when nothing uses them", () => {
    const mainEnum = createEnum(["admin", "user"]);
    const branchEnum = createEnum(["admin", "user", "store"]);

    const execution = buildExecutionPlan(createContext(mainEnum, branchEnum), [
      new AlterEnumAddValue({
        enum: mainEnum,
        newValue: "store",
        position: { after: "user" },
      }),
    ]);

    expect(execution.units).toHaveLength(1);
    expect(execution.units[0].reason).toBe("default");
  });

  test("groups multiple enum additions before a dependent consumer", () => {
    const mainEnum = createEnum(["admin", "user"]);
    const branchEnum = createEnum(["admin", "user", "store", "auditor"]);
    const column = createEnumColumn("'auditor'::public.user_role");

    const execution = buildExecutionPlan(createContext(mainEnum, branchEnum), [
      new AlterEnumAddValue({
        enum: mainEnum,
        newValue: "store",
        position: { after: "user" },
      }),
      new AlterEnumAddValue({
        enum: mainEnum,
        newValue: "auditor",
        position: { after: "store" },
      }),
      new AlterTableAlterColumnSetDefault({
        table: createTable(column),
        column,
      }),
    ]);

    expect(execution.units).toHaveLength(2);
    expect(execution.units[0].statements.map((stmt) => stmt.sql))
      .toMatchInlineSnapshot(`
      [
        "ALTER TYPE public.user_role ADD VALUE 'store' AFTER 'user'",
        "ALTER TYPE public.user_role ADD VALUE 'auditor' AFTER 'store'",
      ]
    `);
  });

  test("splits after enum values before opaque later statements", () => {
    const mainEnum = createEnum(["admin", "user"]);
    const branchEnum = createEnum(["admin", "user", "store"]);

    const execution = buildExecutionPlan(createContext(mainEnum, branchEnum), [
      new AlterEnumAddValue({
        enum: mainEnum,
        newValue: "store",
        position: { after: "user" },
      }),
      new OpaqueEnumConsumerChange() as unknown as Change,
    ]);

    expect(execution.units).toHaveLength(2);
    expect(execution.units[1].reason).toBe("enum_value_visibility");
    expect(execution.units[1].statements[0].sql).toBe(
      "CREATE VIEW public.store_profiles AS SELECT 'store'::public.user_role AS role",
    );
  });

  test("puts non-transactional SQL in its own unit", () => {
    const execution = buildExecutionPlan(emptyContext(), [
      new ConcurrentIndexChange() as unknown as Change,
    ]);

    expect(execution.units).toMatchInlineSnapshot(`
      [
        {
          "id": "unit_001",
          "name": "non_transactional",
          "reason": "non_transactional",
          "statements": [
            {
              "changeId": "create:object:index:CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)",
              "id": "stmt_0001",
              "producesCommittedEffects": [],
              "requiresCommittedEffects": [],
              "sql": "CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)",
            },
          ],
          "transactionMode": "none",
        },
      ]
    `);
  });
});

class ConcurrentIndexChange extends BaseChange {
  readonly operation = "create";
  readonly objectType = "index";
  readonly scope = "object";

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

function createContext(mainEnum: Enum, branchEnum: Enum): DiffContext {
  return {
    mainCatalog: {
      enums: { "public.user_role": mainEnum },
    },
    branchCatalog: {
      enums: { "public.user_role": branchEnum },
    },
  } as unknown as DiffContext;
}

function emptyContext(): DiffContext {
  return {
    mainCatalog: { enums: {} },
    branchCatalog: { enums: {} },
  } as unknown as DiffContext;
}
