import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { expandReplaceDependencies } from "./expand-replace-dependencies.ts";
import { DefaultPrivilegeState } from "./objects/base.default-privileges.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import { Procedure } from "./objects/procedure/procedure.model.ts";
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
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => [],
    get requiresForDrop(): string[] {
      return [];
    },
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

  test("does not replace the owning table for an owned sequence recreation", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainSequence = new Sequence({
      schema: "public",
      name: "user_id_seq",
      data_type: "integer",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 2147483647n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
      comment: null,
      privileges: [],
      owner: "postgres",
    });
    const branchSequence = new Sequence({
      ...mainSequence,
      data_type: "bigint",
      maximum_value: 9223372036854775807n,
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
});
