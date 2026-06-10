import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { expandReplaceDependencies } from "./expand-replace-dependencies.ts";
import { DefaultPrivilegeState } from "./objects/base.default-privileges.ts";
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
import { CreateCommentOnRule } from "./objects/rule/changes/rule.comment.ts";
import { CreateRule } from "./objects/rule/changes/rule.create.ts";
import { DropRule } from "./objects/rule/changes/rule.drop.ts";
import { Rule } from "./objects/rule/rule.model.ts";
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
import { Table } from "./objects/table/table.model.ts";
import { CreateCommentOnTrigger } from "./objects/trigger/changes/trigger.comment.ts";
import { CreateTrigger } from "./objects/trigger/changes/trigger.create.ts";
import { DropTrigger } from "./objects/trigger/changes/trigger.drop.ts";
import { Trigger } from "./objects/trigger/trigger.model.ts";
import { CreateEnum } from "./objects/type/enum/changes/enum.create.ts";
import { DropEnum } from "./objects/type/enum/changes/enum.drop.ts";
import { Enum } from "./objects/type/enum/enum.model.ts";
import { CreateView } from "./objects/view/changes/view.create.ts";
import { DropView } from "./objects/view/changes/view.drop.ts";
import { View } from "./objects/view/view.model.ts";

function mockChange(overrides: {
  creates?: string[];
  drops?: string[];
  invalidates?: string[];
}): Change {
  const { creates = [], drops = [], invalidates = [] } = overrides;
  return {
    objectType: "table",
    operation: "create",
    scope: "object",
    creates,
    drops,
    invalidates,
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => [],
    get requiresForDrop(): string[] {
      return [];
    },
  } as unknown as Change;
}

function catalogWith(
  catalog: Catalog,
  overrides: Partial<ConstructorParameters<typeof Catalog>[0]>,
): Catalog {
  return new Catalog(
    Object.assign({}, catalog, overrides) as ConstructorParameters<
      typeof Catalog
    >[0],
  );
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

  test("promotes dependent rule when a procedure's signature changes", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const procedureBase = {
      schema: "public",
      name: "is_valid_amount",
      kind: "f" as const,
      return_type: "boolean",
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
      argument_names: ["value"],
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      source_code: "SELECT value > 0",
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
      definition:
        "CREATE FUNCTION public.is_valid_amount(value integer) RETURNS boolean ...",
    });
    const branchProcedure = new Procedure({
      ...procedureBase,
      argument_types: ["int8"],
      definition:
        "CREATE FUNCTION public.is_valid_amount(value bigint) RETURNS boolean ...",
    });
    const ruleBase = {
      schema: "public",
      name: "block_invalid_amount",
      table_name: "items",
      relation_kind: "r" as const,
      event: "INSERT" as const,
      enabled: "D" as const,
      is_instead: true,
      owner: "postgres",
      definition:
        "CREATE RULE block_invalid_amount AS ON INSERT TO public.items WHERE NOT public.is_valid_amount(new.amount) DO INSTEAD NOTHING",
      comment: "rule comment",
      columns: ["amount"],
    };
    const mainRule = new Rule(ruleBase);
    const branchRule = new Rule({
      ...ruleBase,
      definition:
        "CREATE RULE block_invalid_amount AS ON INSERT TO public.items WHERE NOT public.is_valid_amount(new.amount::bigint) DO INSTEAD NOTHING",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new CreateRule({ rule: branchRule, orReplace: true }),
    ];
    const mainCatalog = catalogWith(baseline, {
      procedures: { [mainProcedure.stableId]: mainProcedure },
      rules: { [mainRule.stableId]: mainRule },
      depends: [
        {
          dependent_stable_id: mainRule.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = catalogWith(baseline, {
      procedures: { [branchProcedure.stableId]: branchProcedure },
      rules: { [branchRule.stableId]: branchRule },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropRule)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateRule)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateCommentOnRule)).toBe(
      true,
    );
  });

  test("promotes dependent rule and trigger when a column is invalidated", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const ruleBase = {
      schema: "public",
      name: "block_blocked_accounts",
      table_name: "accounts",
      relation_kind: "r" as const,
      event: "INSERT" as const,
      enabled: "O" as const,
      is_instead: true,
      owner: "postgres",
      definition:
        "CREATE RULE block_blocked_accounts AS ON INSERT TO public.accounts WHERE new.status = 'blocked' DO INSTEAD NOTHING",
      comment: null,
      columns: ["status"],
    };
    const mainRule = new Rule(ruleBase);
    const branchRule = new Rule({
      ...ruleBase,
      definition:
        "CREATE RULE block_blocked_accounts AS ON INSERT TO public.accounts WHERE new.status = 'blocked'::public.account_status DO INSTEAD NOTHING",
    });
    const triggerBase = {
      schema: "public",
      name: "block_blocked_accounts",
      table_name: "accounts",
      table_relkind: "r" as const,
      function_schema: "public",
      function_name: "noop_trigger",
      trigger_type: 23,
      enabled: "O" as const,
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: [],
      arguments: [],
      when_condition: "new.status = 'blocked'::text",
      old_table: null,
      new_table: null,
      is_partition_clone: false,
      parent_trigger_name: null,
      parent_table_schema: null,
      parent_table_name: null,
      is_on_partitioned_table: false,
      owner: "postgres",
      definition:
        "CREATE TRIGGER block_blocked_accounts BEFORE INSERT ON public.accounts FOR EACH ROW WHEN (new.status = 'blocked'::text) EXECUTE FUNCTION public.noop_trigger()",
      comment: "trigger comment",
    };
    const mainTrigger = new Trigger(triggerBase);
    const branchTrigger = new Trigger({
      ...triggerBase,
      enabled: "D",
      when_condition: "new.status = 'blocked'::public.account_status",
      definition:
        "CREATE TRIGGER block_blocked_accounts BEFORE INSERT ON public.accounts FOR EACH ROW WHEN (new.status = 'blocked'::public.account_status) EXECUTE FUNCTION public.noop_trigger()",
    });
    const changes: Change[] = [
      mockChange({ invalidates: ["column:public.accounts.status"] }),
      new CreateRule({ rule: branchRule, orReplace: true }),
      new CreateTrigger({ trigger: branchTrigger, orReplace: true }),
    ];
    const mainCatalog = catalogWith(baseline, {
      rules: { [mainRule.stableId]: mainRule },
      triggers: { [mainTrigger.stableId]: mainTrigger },
      depends: [
        {
          dependent_stable_id: mainRule.stableId,
          referenced_stable_id: "column:public.accounts.status",
          deptype: "n",
        },
        {
          dependent_stable_id: mainTrigger.stableId,
          referenced_stable_id: "column:public.accounts.status",
          deptype: "n",
        },
      ],
    });
    const branchCatalog = catalogWith(baseline, {
      rules: { [branchRule.stableId]: branchRule },
      triggers: { [branchTrigger.stableId]: branchTrigger },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropRule)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateRule)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof DropTrigger)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateTrigger)).toBe(true);
    expect(
      expanded.changes.some((c) => c instanceof CreateCommentOnTrigger),
    ).toBe(true);
    expect(
      expanded.changes.some((c) => c.serialize().includes("DISABLE TRIGGER")),
    ).toBe(true);
  });

  test("keeps a drop-only dependent trigger when a column is invalidated", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const trigger = new Trigger({
      schema: "public",
      name: "block_blocked_accounts",
      table_name: "accounts",
      table_relkind: "r",
      function_schema: "public",
      function_name: "noop_trigger",
      trigger_type: 23,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: [],
      arguments: [],
      when_condition: "new.status = 'blocked'::text",
      old_table: null,
      new_table: null,
      is_partition_clone: false,
      parent_trigger_name: null,
      parent_table_schema: null,
      parent_table_name: null,
      is_on_partitioned_table: false,
      owner: "postgres",
      definition:
        "CREATE TRIGGER block_blocked_accounts BEFORE INSERT ON public.accounts FOR EACH ROW WHEN (new.status = 'blocked'::text) EXECUTE FUNCTION public.noop_trigger()",
      comment: null,
    });
    const changes: Change[] = [
      mockChange({ invalidates: ["column:public.accounts.status"] }),
      new DropTrigger({ trigger }),
    ];
    const mainCatalog = catalogWith(baseline, {
      triggers: { [trigger.stableId]: trigger },
      depends: [
        {
          dependent_stable_id: trigger.stableId,
          referenced_stable_id: "column:public.accounts.status",
          deptype: "n",
        },
      ],
    });
    const branchCatalog = catalogWith(baseline, {
      triggers: {},
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter((c) => c instanceof DropTrigger),
    ).toHaveLength(1);
    expect(expanded.changes.some((c) => c instanceof CreateTrigger)).toBe(
      false,
    );
  });
});
