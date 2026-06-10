import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { expandReplaceDependencies } from "./expand-replace-dependencies.ts";
import { DefaultPrivilegeState } from "./objects/base.default-privileges.ts";
import {
  AlterDomainDropDefault,
  AlterDomainSetDefault,
} from "./objects/domain/changes/domain.alter.ts";
import { CreateDomain } from "./objects/domain/changes/domain.create.ts";
import { DropDomain } from "./objects/domain/changes/domain.drop.ts";
import { Domain } from "./objects/domain/domain.model.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import { Procedure } from "./objects/procedure/procedure.model.ts";
import {
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "./objects/rls-policy/changes/rls-policy.alter.ts";
import { CreateCommentOnRlsPolicy } from "./objects/rls-policy/changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./objects/rls-policy/changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./objects/rls-policy/changes/rls-policy.drop.ts";
import { RlsPolicy } from "./objects/rls-policy/rls-policy.model.ts";
import { CreateSequence } from "./objects/sequence/changes/sequence.create.ts";
import { DropSequence } from "./objects/sequence/changes/sequence.drop.ts";
import { diffSequences } from "./objects/sequence/sequence.diff.ts";
import { Sequence } from "./objects/sequence/sequence.model.ts";
import {
  AlterTableAlterColumnSetDefault,
  AlterTableChangeOwner,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableSetReplicaIdentity,
} from "./objects/table/changes/table.alter.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { GrantTablePrivileges } from "./objects/table/changes/table.privilege.ts";
import { Table, type TableProps } from "./objects/table/table.model.ts";
import { CreateEnum } from "./objects/type/enum/changes/enum.create.ts";
import { DropEnum } from "./objects/type/enum/changes/enum.drop.ts";
import { Enum } from "./objects/type/enum/enum.model.ts";
import { CreateView } from "./objects/view/changes/view.create.ts";
import { DropView } from "./objects/view/changes/view.drop.ts";
import { View } from "./objects/view/view.model.ts";

function mockChange(overrides: {
  creates?: string[];
  drops?: string[];
}): Change {
  const { creates = [], drops = [] } = overrides;
  return {
    objectType: "table",
    operation: "create",
    scope: "object",
    creates,
    drops,
    invalidates: [],
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => [],
    get requiresForDrop(): string[] {
      return [];
    },
  } as unknown as Change;
}

function mockInvalidatingChange(invalidates: string[]): Change {
  return {
    objectType: "table",
    operation: "alter",
    scope: "object",
    creates: [],
    drops: [],
    invalidates,
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => "",
  } as unknown as Change;
}

function procedureWithArgs(argumentTypes: string[]): Procedure {
  return new Procedure({
    schema: "public",
    name: "normalize_value",
    kind: "f",
    return_type: "integer",
    return_type_schema: "pg_catalog",
    language: "sql",
    security_definer: false,
    volatility: "i",
    parallel_safety: "u",
    execution_cost: 100,
    result_rows: 0,
    is_strict: false,
    leakproof: false,
    returns_set: false,
    argument_count: argumentTypes.length,
    argument_default_count: 0,
    argument_names: argumentTypes.map((_, index) => `arg${index + 1}`),
    argument_types: argumentTypes,
    all_argument_types: null,
    argument_modes: null,
    argument_defaults: null,
    source_code: "SELECT 1",
    binary_path: null,
    sql_body: null,
    config: null,
    definition: "CREATE FUNCTION public.normalize_value(...) RETURNS integer",
    owner: "postgres",
    comment: null,
    privileges: [],
  });
}

function tableWithDefault(
  columnDefault: string | null,
  columnOverrides: Partial<TableProps["columns"][number]> = {},
): Table {
  return new Table({
    schema: "public",
    name: "items",
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
    owner: "postgres",
    comment: null,
    parent_schema: null,
    parent_name: null,
    columns: [
      {
        name: "value",
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
        default: columnDefault,
        comment: null,
        ...columnOverrides,
      },
    ],
    privileges: [],
  });
}

function domainWithDefault(defaultValue: string | null): Domain {
  return new Domain({
    schema: "public",
    name: "item_value",
    base_type: "int4",
    base_type_schema: "pg_catalog",
    base_type_str: "integer",
    not_null: false,
    type_modifier: null,
    array_dimensions: null,
    collation: null,
    default_bin: defaultValue,
    default_value: defaultValue,
    owner: "postgres",
    comment: null,
    constraints: [],
    privileges: [],
  });
}

describe("expandReplaceDependencies", () => {
  test("returns changes unchanged when there are no replace roots", async () => {
    const catalog = await createEmptyCatalog(160004, "u");
    const changes: Change[] = [
      mockChange({ creates: ["table:public.t"], drops: [] }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog: catalog,
      branchCatalog: catalog,
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes).toBe(changes);
    expect(result.replacedTableIds.size).toBe(0);
  });

  test("returns changes unchanged when replace roots have no dependents in catalog", async () => {
    const catalog = await createEmptyCatalog(160004, "u");
    const changes: Change[] = [
      mockChange({
        creates: ["type:public.e"],
        drops: ["type:public.e"],
      }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog: catalog,
      branchCatalog: catalog,
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toBe(changes[0]);
    expect(result.replacedTableIds.size).toBe(0);
  });

  test("returns same array reference when replaceRoots.size is 0", async () => {
    const catalog = await createEmptyCatalog(160004, "u");
    const changes: Change[] = [
      mockChange({ creates: ["table:public.a"], drops: ["table:public.b"] }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog: catalog,
      branchCatalog: catalog,
    });
    expect(result.changes).toBe(changes);
    expect(result.replacedTableIds.size).toBe(0);
  });

  test("promotes surviving dependent view when its referenced table is dropped without a same-name create", async () => {
    // Reproduces issue #228 case 3: ALTER TABLE users RENAME TO members.
    // pg-delta sees `users` as drop-only and `members` as create-only — the
    // stableIds differ, so neither is in the createdIds∩droppedIds replace
    // root set. The dependent view `user_count` exists in both catalogs
    // (its definition was rewritten to FROM members in branch). Without
    // expansion, DROP TABLE users would fail because user_count still
    // references it. The expander must seed the drop-only table as a root
    // so the surviving dependent gets promoted to DROP+CREATE.
    const baseline = await createEmptyCatalog(170000, "postgres");
    const usersTable = new Table({
      schema: "public",
      name: "users",
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
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
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
          not_null: true,
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
    const mainView = new View({
      schema: "public",
      name: "user_count",
      owner: "postgres",
      definition: " SELECT count(*) AS n FROM public.users;",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      partition_bound: null,
      comment: null,
      columns: [
        {
          name: "n",
          position: 1,
          data_type: "bigint",
          data_type_str: "bigint",
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
      options: null,
      privileges: [],
    });
    const branchView = new View({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainView,
      definition: " SELECT count(*) AS n FROM public.members;",
    });

    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      tables: { [usersTable.stableId]: usersTable },
      views: { [mainView.stableId]: mainView },
      depends: [
        {
          dependent_stable_id: mainView.stableId,
          referenced_stable_id: usersTable.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      views: { [branchView.stableId]: branchView },
    });

    // Simulated planner output: DropTable(users) + CreateView orReplace(user_count).
    // The surviving view appears only as a "create" (CREATE OR REPLACE VIEW),
    // never as a drop, so DROP TABLE users would fail without expansion.
    const changes: Change[] = [
      new DropTable({ table: usersTable }),
      new CreateView({ view: branchView, orReplace: true }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    // The view's surviving CREATE OR REPLACE remains, AND a DropView is
    // injected so the drop phase removes the view before the table.
    expect(result.changes.some((c) => c instanceof DropView)).toBe(true);
  });

  test("does not replace the owning table for an owned sequence recreation", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    // Use `persistence` (UNLOGGED → LOGGED) to trigger the
    // non-alterable replace path: it's the only field still in
    // NON_ALTERABLE_FIELDS. `data_type` was previously in that list
    // but is now alterable in place via ALTER SEQUENCE ... AS <type>.
    const mainSequence = new Sequence({
      schema: "public",
      name: "user_id_seq",
      data_type: "bigint",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 9223372036854775807n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "u",
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
      comment: null,
      privileges: [],
      owner: "postgres",
    });
    const branchSequence = new Sequence({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainSequence,
      persistence: "p",
    });
    const usersTable = new Table({
      schema: "public",
      name: "users",
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
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "bigint",
          data_type_str: "bigint",
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
          default: "nextval('public.user_id_seq'::regclass)",
          comment: null,
        },
      ],
      privileges: [],
    });
    const changes = diffSequences(
      {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
      { [mainSequence.stableId]: mainSequence },
      { [branchSequence.stableId]: branchSequence },
      { [usersTable.stableId]: usersTable },
    );
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      sequences: { [mainSequence.stableId]: mainSequence },
      tables: { [usersTable.stableId]: usersTable },
      depends: [
        {
          dependent_stable_id: mainSequence.stableId,
          referenced_stable_id: "column:public.users.id",
          deptype: "a",
        },
        {
          dependent_stable_id: "column:public.users.id",
          referenced_stable_id: mainSequence.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      sequences: { [branchSequence.stableId]: branchSequence },
      tables: { [usersTable.stableId]: usersTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(changes[0]).toBeInstanceOf(DropSequence);
    expect(changes[1]).toBeInstanceOf(CreateSequence);
    expect(changes[3]).toBeInstanceOf(AlterTableAlterColumnSetDefault);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.size).toBe(0);
  });

  test("reports replaced tables for downstream post-diff normalization", async () => {
    // Reproduction guard for the enum-replacement expansion case: the expander
    // must report which dependent tables it promoted to DropTable+CreateTable,
    // but the pruning of same-table AlterTableDropColumn/DropConstraint belongs
    // to the later post-diff normalization pass, not this expansion step.
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainEnum = new Enum({
      schema: "public",
      name: "item_status",
      owner: "postgres",
      labels: [
        { sort_order: 1, label: "draft" },
        { sort_order: 2, label: "published" },
        { sort_order: 3, label: "archived" },
      ],
      comment: null,
      privileges: [],
    });
    const branchEnum = new Enum({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainEnum,
      labels: [
        { sort_order: 1, label: "draft" },
        { sort_order: 2, label: "published" },
      ],
    });
    const columnTemplate = {
      data_type: "integer" as const,
      data_type_str: "integer",
      is_custom_type: false as const,
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
    };
    const mainChildren = new Table({
      schema: "public",
      name: "children",
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
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      columns: [
        { ...columnTemplate, name: "id", position: 1, not_null: true },
        { ...columnTemplate, name: "parent_ref", position: 2 },
        {
          ...columnTemplate,
          name: "status",
          position: 3,
          data_type: "item_status",
          data_type_str: "public.item_status",
          is_custom_type: true,
          custom_type_type: "e",
          custom_type_category: "E",
          custom_type_schema: "public",
          custom_type_name: "item_status",
        },
      ],
      privileges: [],
    });
    const branchChildren = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainChildren,
      columns: [
        { ...columnTemplate, name: "id", position: 1, not_null: true },
        {
          ...columnTemplate,
          name: "status",
          position: 2,
          data_type: "item_status",
          data_type_str: "public.item_status",
          is_custom_type: true,
          custom_type_type: "e",
          custom_type_category: "E",
          custom_type_schema: "public",
          custom_type_name: "item_status",
        },
      ],
    });

    // Pre-existing planner output: the enum replacement from diffEnums plus
    // targeted ALTER TABLE statements from diffTables. The two cycle-forming
    // ALTERs (drop-column, drop-constraint) must be elided. The privilege
    // ALTER and the owner / RLS / replica-identity ALTERs must all survive.
    const droppedColumn = mainChildren.columns.find(
      (c) => c.name === "parent_ref",
    );
    if (!droppedColumn) throw new Error("test setup: parent_ref missing");
    const preExistingDropColumn = new AlterTableDropColumn({
      table: mainChildren,
      column: droppedColumn,
    });
    const preExistingDropConstraint = new AlterTableDropConstraint({
      table: mainChildren,
      constraint: {
        name: "children_parent_ref_fkey",
        constraint_type: "f",
        deferrable: false,
        initially_deferred: false,
        validated: true,
        is_local: true,
        no_inherit: false,
        is_temporal: false,
        is_partition_clone: false,
        parent_constraint_schema: null,
        parent_constraint_name: null,
        parent_table_schema: null,
        parent_table_name: null,
        key_columns: ["parent_ref"],
        foreign_key_columns: ["id"],
        foreign_key_table: "parents",
        foreign_key_schema: "public",
        foreign_key_table_is_partition: false,
        foreign_key_parent_schema: null,
        foreign_key_parent_table: null,
        foreign_key_effective_schema: "public",
        foreign_key_effective_table: "parents",
        on_update: "a",
        on_delete: "a",
        match_type: "s",
        check_expression: null,
        owner: "postgres",
        definition: "FOREIGN KEY (parent_ref) REFERENCES public.parents(id)",
        comment: null,
      },
    });
    const preExistingChangeOwner = new AlterTableChangeOwner({
      table: branchChildren,
      owner: "new_owner",
    });
    const preExistingEnableRls = new AlterTableEnableRowLevelSecurity({
      table: branchChildren,
    });
    const preExistingReplicaIdentity = new AlterTableSetReplicaIdentity({
      table: branchChildren,
      mode: "f",
    });
    const preExistingGrant = new GrantTablePrivileges({
      table: branchChildren,
      grantee: "reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    });
    const changes: Change[] = [
      new DropEnum({ enum: mainEnum }),
      new CreateEnum({ enum: branchEnum }),
      preExistingDropColumn,
      preExistingDropConstraint,
      preExistingChangeOwner,
      preExistingEnableRls,
      preExistingReplicaIdentity,
      preExistingGrant,
    ];

    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      enums: { [mainEnum.stableId]: mainEnum },
      tables: { [mainChildren.stableId]: mainChildren },
      // pg_depend: column children.status depends on type item_status.
      depends: [
        {
          dependent_stable_id: "column:public.children.status",
          referenced_stable_id: mainEnum.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      enums: { [branchEnum.stableId]: branchEnum },
      tables: { [branchChildren.stableId]: branchChildren },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    // The replace-table pair was added.
    expect(expanded.changes.some((c) => c instanceof DropTable)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateTable)).toBe(true);
    expect(expanded.replacedTableIds.has(mainChildren.stableId)).toBe(true);
    // Expansion itself keeps the pre-existing ALTERs; the post-diff cycle pass
    // decides which of them are superseded by the replacement.
    expect(expanded.changes).toContain(preExistingDropColumn);
    expect(expanded.changes).toContain(preExistingDropConstraint);
    expect(
      expanded.changes.some((c) => c instanceof AlterTableDropColumn),
    ).toBe(true);
    expect(
      expanded.changes.some((c) => c instanceof AlterTableDropConstraint),
    ).toBe(true);
    // The enum replace roots are still present.
    expect(expanded.changes.some((c) => c instanceof DropEnum)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateEnum)).toBe(true);
    // Non-cycle object-scope ALTERs are carried through untouched.
    expect(expanded.changes).toContain(preExistingChangeOwner);
    expect(expanded.changes).toContain(preExistingEnableRls);
    expect(expanded.changes).toContain(preExistingReplicaIdentity);
    // Privilege-scope ALTER on the recreated table survives.
    expect(expanded.changes).toContain(preExistingGrant);
    expect(expanded.replacedTableIds.has("table:public.parents")).toBe(false);
  });

  test("promotes dependent view when a procedure's parameter types change", async () => {
    // Procedure stableIds are signature-qualified, so a parameter-type change
    // produces different stableIds in `createdIds` and `droppedIds`. The
    // expander must still treat the (schema, name)-matched pair as a replace
    // root so a dependent view is promoted from `CREATE OR REPLACE VIEW` to
    // `DROP VIEW` + `CREATE VIEW` (otherwise `DROP FUNCTION` fails with
    // "cannot drop function because other objects depend on it").
    const baseline = await createEmptyCatalog(170000, "postgres");
    const procedureBase = {
      schema: "public",
      name: "format_id",
      kind: "f" as const,
      return_type: "text",
      return_type_schema: "pg_catalog",
      language: "sql",
      security_definer: false,
      volatility: "i" as const,
      parallel_safety: "u" as const,
      execution_cost: 100,
      result_rows: 0,
      is_strict: false,
      leakproof: false,
      returns_set: false,
      argument_count: 1,
      argument_default_count: 0,
      argument_names: ["id"],
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      source_code: "SELECT 'id:' || id::text",
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "postgres",
      comment: null,
      privileges: [],
    };
    const mainProcedure = new Procedure({
      ...procedureBase,
      argument_types: ["int4"],
      definition: "CREATE FUNCTION public.format_id(id integer) ...",
    });
    const branchProcedure = new Procedure({
      ...procedureBase,
      argument_types: ["int8"],
      definition: "CREATE FUNCTION public.format_id(id bigint) ...",
    });
    const viewBase = {
      schema: "public",
      name: "items_formatted",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d" as const,
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "postgres",
      comment: null,
      columns: [],
      privileges: [],
    };
    const mainView = new View({
      ...viewBase,
      definition: "SELECT public.format_id(id) FROM public.items",
    });
    const branchView = new View({
      ...viewBase,
      definition: "SELECT public.format_id(id::bigint) FROM public.items",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      // view.diff emits this because pg_get_viewdef text differs after the
      // underlying function signature changes.
      new CreateView({ view: branchView, orReplace: true }),
    ];

    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      views: { [mainView.stableId]: mainView },
      depends: [
        {
          dependent_stable_id: mainView.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      views: { [branchView.stableId]: branchView },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropView)).toBe(true);
  });

  test("promotes dependent RLS policy when a procedure's signature changes", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const procedureBase = {
      schema: "public",
      name: "check_role",
      kind: "f" as const,
      return_type: "boolean",
      return_type_schema: "pg_catalog",
      language: "plpgsql",
      security_definer: false,
      volatility: "v" as const,
      parallel_safety: "u" as const,
      execution_cost: 100,
      result_rows: 0,
      is_strict: false,
      leakproof: false,
      returns_set: false,
      argument_names: ["id", "role"],
      all_argument_types: null,
      argument_modes: null,
      source_code: "BEGIN RETURN true; END;",
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "postgres",
      comment: null,
      privileges: [],
    };
    const mainProcedure = new Procedure({
      ...procedureBase,
      argument_count: 2,
      argument_default_count: 0,
      argument_types: ["uuid", "text"],
      argument_defaults: null,
      definition:
        "CREATE FUNCTION public.check_role(id uuid, role text) RETURNS boolean ...",
    });
    const branchProcedure = new Procedure({
      ...procedureBase,
      argument_count: 3,
      argument_default_count: 1,
      argument_names: ["id", "role", "extra"],
      argument_types: ["uuid", "text", "text"],
      argument_defaults: "'default'::text",
      definition:
        "CREATE FUNCTION public.check_role(id uuid, role text, extra text DEFAULT 'default'::text) RETURNS boolean ...",
    });
    const policyBase = {
      schema: "public",
      table_name: "profiles",
      name: "check_role_policy",
      command: "r" as const,
      permissive: true,
      roles: ["public"],
      using_expression: "public.check_role(id, role)",
      with_check_expression: null,
      owner: "postgres",
      comment: "policy comment",
      referenced_relations: [],
    };
    const mainPolicy = new RlsPolicy({
      ...policyBase,
      referenced_procedures: [
        {
          schema: "public",
          name: "check_role",
          argument_types: ["uuid", "text"],
        },
      ],
    });
    const branchPolicy = new RlsPolicy({
      ...policyBase,
      referenced_procedures: [
        {
          schema: "public",
          name: "check_role",
          argument_types: ["uuid", "text", "text"],
        },
      ],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      rlsPolicies: { [mainPolicy.stableId]: mainPolicy },
      depends: [
        {
          dependent_stable_id: mainPolicy.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      rlsPolicies: { [branchPolicy.stableId]: branchPolicy },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropRlsPolicy)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateRlsPolicy)).toBe(
      true,
    );
    expect(
      expanded.changes.some((c) => c instanceof CreateCommentOnRlsPolicy),
    ).toBe(true);
  });

  test("promotes dependent RLS policy when a referenced column is invalidated", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const columnTemplate = {
      position: 1,
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
    };
    const tableBase = {
      schema: "public",
      name: "solution_categories_with_policy",
      persistence: "p" as const,
      row_security: true,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d" as const,
      is_partition: false,
      options: null,
      partition_bound: null,
      partition_by: null,
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      constraints: [],
      privileges: [],
    };
    const mainRoleColumn = {
      ...columnTemplate,
      name: "role",
    };
    const branchRoleColumn = {
      ...columnTemplate,
      name: "role",
      data_type: "user_role_enum",
      data_type_str: "public.user_role_enum",
      is_custom_type: true,
      custom_type_type: "e",
      custom_type_category: "E",
      custom_type_schema: "public",
      custom_type_name: "user_role_enum",
    };
    const mainTable = new Table({
      ...tableBase,
      columns: [mainRoleColumn],
    });
    const branchTable = new Table({
      ...tableBase,
      columns: [branchRoleColumn],
    });
    const policyBase = {
      schema: "public",
      table_name: "solution_categories_with_policy",
      name: "categories_admin_manage",
      command: "*" as const,
      permissive: true,
      roles: ["public"],
      owner: "postgres",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    };
    const mainPolicy = new RlsPolicy({
      ...policyBase,
      using_expression: "role = 'admin'",
      with_check_expression: "role = 'admin'",
    });
    const branchPolicy = new RlsPolicy({
      ...policyBase,
      using_expression: "role = 'admin'::public.user_role_enum",
      with_check_expression: "role = 'admin'::public.user_role_enum",
    });
    const alterUsing = new AlterRlsPolicySetUsingExpression({
      policy: mainPolicy,
      usingExpression: branchPolicy.using_expression,
    });
    const alterWithCheck = new AlterRlsPolicySetWithCheckExpression({
      policy: mainPolicy,
      withCheckExpression: branchPolicy.with_check_expression,
    });
    const changes: Change[] = [
      mockInvalidatingChange([
        "column:public.solution_categories_with_policy.role",
      ]),
      alterUsing,
      alterWithCheck,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      tables: { [mainTable.stableId]: mainTable },
      rlsPolicies: { [mainPolicy.stableId]: mainPolicy },
      depends: [
        {
          dependent_stable_id: mainPolicy.stableId,
          referenced_stable_id:
            "column:public.solution_categories_with_policy.role",
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      tables: { [branchTable.stableId]: branchTable },
      rlsPolicies: { [branchPolicy.stableId]: branchPolicy },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropRlsPolicy)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateRlsPolicy)).toBe(
      true,
    );
    expect(expanded.changes).not.toContain(alterUsing);
    expect(expanded.changes).not.toContain(alterWithCheck);
  });

  test("does not replace a table when a procedure signature replacement is covered by a column default alter", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainTable = tableWithDefault("public.normalize_value(1)");
    const branchTable = tableWithDefault("public.normalize_value((1)::bigint)");
    const setDefault = new AlterTableAlterColumnSetDefault({
      table: branchTable,
      column: branchTable.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      setDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(setDefault);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("does not replace a domain or table when a procedure signature replacement is covered by a domain default alter", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainDomain = domainWithDefault("public.normalize_value(1)");
    const branchDomain = domainWithDefault(
      "public.normalize_value((1)::bigint)",
    );
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });
    const setDomainDefault = new AlterDomainSetDefault({
      domain: mainDomain,
      defaultValue: branchDomain.default_value ?? "NULL",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      setDomainDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: mainDomain.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(setDomainDefault);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
    expect(
      expanded.changes.some((change) => change instanceof CreateDomain),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(tableUsingDomain.stableId)).toBe(
      false,
    );
  });

  test("does not replace a domain or table when a procedure signature replacement is covered by dropping a domain default", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainDomain = domainWithDefault("public.normalize_value(1)");
    const branchDomain = domainWithDefault(null);
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });
    const dropDomainDefault = new AlterDomainDropDefault({
      domain: mainDomain,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      dropDomainDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: mainDomain.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(dropDomainDefault);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
    expect(
      expanded.changes.some((change) => change instanceof CreateDomain),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(tableUsingDomain.stableId)).toBe(
      false,
    );
  });
});
