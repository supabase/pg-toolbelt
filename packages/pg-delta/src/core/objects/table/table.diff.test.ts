import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnAddIdentity,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropIdentity,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetGenerated,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableChangeOwner,
  AlterTableDisableRowLevelSecurity,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableResetStorageParams,
  AlterTableSetLogged,
  AlterTableSetReplicaIdentity,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  AlterTableValidateConstraint,
} from "./changes/table.alter.ts";
import { CreateTable } from "./changes/table.create.ts";
import { DropTable } from "./changes/table.drop.ts";
import {
  GrantTablePrivileges,
  RevokeGrantOptionTablePrivileges,
  RevokeTablePrivileges,
} from "./changes/table.privilege.ts";
import { diffTables } from "./table.diff.ts";
import { Table, type TableProps } from "./table.model.ts";

const base: TableProps = {
  schema: "public",
  name: "t",
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
  owner: "o1",
  parent_schema: null,
  parent_name: null,
  columns: [],
  privileges: [],
};

// Test context with empty default privileges state
const testContext = {
  version: 150014,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("table.diff", () => {
  test("create and drop", () => {
    const t = new Table(base);
    const created = diffTables(testContext, {}, { [t.stableId]: t });
    expect(created[0]).toBeInstanceOf(CreateTable);
    const dropped = diffTables(testContext, { [t.stableId]: t }, {});
    expect(dropped[0]).toBeInstanceOf(DropTable);
  });

  test("created NOT VALID CHECK emits AddConstraint only (no Validate)", () => {
    const main = new Table({
      ...base,
      name: "t_nv",
      columns: [
        {
          name: "a",
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
      constraints: [],
    });
    const branch = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...main,
      constraints: [
        {
          name: "ck_nv",
          constraint_type: "c" as const,
          deferrable: false,
          initially_deferred: false,
          validated: false,
          is_local: true,
          no_inherit: false,
          is_temporal: false,
          is_partition_clone: false,
          parent_constraint_schema: null,
          parent_constraint_name: null,
          parent_table_schema: null,
          parent_table_name: null,
          key_columns: [],
          foreign_key_columns: null,
          foreign_key_table: null,
          foreign_key_schema: null,
          foreign_key_table_is_partition: null,
          foreign_key_parent_schema: null,
          foreign_key_parent_table: null,
          foreign_key_effective_schema: null,
          foreign_key_effective_table: null,
          on_update: null,
          on_delete: null,
          match_type: null,
          check_expression: "a > 0",
          owner: "o1",
          definition: "CHECK (a > 0) NOT VALID",
        },
      ],
    });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const add = changes.find((c) => c instanceof AlterTableAddConstraint);
    expect(add).toBeInstanceOf(AlterTableAddConstraint);
    expect(add?.serialize()).toContain("NOT VALID");
    expect(changes.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
      false,
    );
  });

  test("NOT VALID -> validated emits only VALIDATE CONSTRAINT (no drop+add)", () => {
    const sharedConstraint = {
      name: "ck_nv",
      constraint_type: "c" as const,
      deferrable: false,
      initially_deferred: false,
      is_local: true,
      no_inherit: false,
      is_temporal: false,
      is_partition_clone: false,
      parent_constraint_schema: null,
      parent_constraint_name: null,
      parent_table_schema: null,
      parent_table_name: null,
      key_columns: [],
      foreign_key_columns: null,
      foreign_key_table: null,
      foreign_key_schema: null,
      foreign_key_table_is_partition: null,
      foreign_key_parent_schema: null,
      foreign_key_parent_table: null,
      foreign_key_effective_schema: null,
      foreign_key_effective_table: null,
      on_update: null,
      on_delete: null,
      match_type: null,
      check_expression: "a > 0",
      owner: "o1",
      comment: null,
    };

    const main = new Table({
      ...base,
      name: "t_nv",
      columns: [
        {
          name: "a",
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
      constraints: [
        {
          ...sharedConstraint,
          validated: false,
          definition: "CHECK (a > 0) NOT VALID",
        },
      ],
    });
    const branch = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...main,
      constraints: [
        {
          ...sharedConstraint,
          validated: true,
          definition: "CHECK (a > 0)",
        },
      ],
    });

    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    const validate = changes.find(
      (c) => c instanceof AlterTableValidateConstraint,
    );
    expect(validate).toBeInstanceOf(AlterTableValidateConstraint);
    expect(validate?.serialize()).toMatchInlineSnapshot(
      `"ALTER TABLE public.t_nv VALIDATE CONSTRAINT ck_nv"`,
    );

    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      false,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      false,
    );
  });

  test("NOT VALID -> validated + other field change still drops+adds (no shortcut)", () => {
    const sharedConstraint = {
      name: "ck_nv",
      constraint_type: "c" as const,
      deferrable: false,
      initially_deferred: false,
      is_local: true,
      no_inherit: false,
      is_temporal: false,
      is_partition_clone: false,
      parent_constraint_schema: null,
      parent_constraint_name: null,
      parent_table_schema: null,
      parent_table_name: null,
      key_columns: [],
      foreign_key_columns: null,
      foreign_key_table: null,
      foreign_key_schema: null,
      foreign_key_table_is_partition: null,
      foreign_key_parent_schema: null,
      foreign_key_parent_table: null,
      foreign_key_effective_schema: null,
      foreign_key_effective_table: null,
      on_update: null,
      on_delete: null,
      match_type: null,
      owner: "o1",
      comment: null,
    };

    const main = new Table({
      ...base,
      name: "t_nv",
      columns: [
        {
          name: "a",
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
      constraints: [
        {
          ...sharedConstraint,
          validated: false,
          check_expression: "a > 0",
          definition: "CHECK (a > 0) NOT VALID",
        },
      ],
    });
    const branch = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...main,
      constraints: [
        {
          ...sharedConstraint,
          validated: true,
          check_expression: "a > 1",
          definition: "CHECK (a > 1)",
        },
      ],
    });

    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
      false,
    );
  });

  test("alter owner", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, owner: "o2" });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterTableChangeOwner);
  });

  test("options change uses ALTER TABLE SET (...) instead of replace", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, options: ["fillfactor=90"] });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterTableSetStorageParams);
  });

  test("option removed emits RESET", () => {
    const main = new Table({
      ...base,
      options: ["fillfactor=90", "autovacuum_enabled=true"],
    });
    const branch = new Table({
      ...base,
      options: ["autovacuum_enabled=true"],
    });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetStorageParams)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableResetStorageParams)).toBe(
      true,
    );
  });

  test("persistence p->u uses ALTER TABLE SET UNLOGGED", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, persistence: "u" });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetUnlogged)).toBe(true);
  });

  test("persistence u->p uses ALTER TABLE SET LOGGED", () => {
    const main = new Table({ ...base, persistence: "u" });
    const branch = new Table({ ...base, persistence: "p" });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetLogged)).toBe(true);
  });

  test("row level security toggles", () => {
    const enable = diffTables(
      testContext,
      {
        "table:public.t1": new Table({
          ...base,
          name: "t1",
          row_security: false,
        }),
      },
      {
        "table:public.t1": new Table({
          ...base,
          name: "t1",
          row_security: true,
        }),
      },
    );
    expect(
      enable.some((c) => c instanceof AlterTableEnableRowLevelSecurity),
    ).toBe(true);
    const disable = diffTables(
      testContext,
      {
        "table:public.t2": new Table({
          ...base,
          name: "t2",
          row_security: true,
        }),
      },
      {
        "table:public.t2": new Table({
          ...base,
          name: "t2",
          row_security: false,
        }),
      },
    );
    expect(
      disable.some((c) => c instanceof AlterTableDisableRowLevelSecurity),
    ).toBe(true);
  });

  test("force row level security toggles", () => {
    const force = diffTables(
      testContext,
      {
        "table:public.t3": new Table({
          ...base,
          name: "t3",
          row_security: true,
          force_row_security: false,
        }),
      },
      {
        "table:public.t3": new Table({
          ...base,
          name: "t3",
          row_security: true,
          force_row_security: true,
        }),
      },
    );
    expect(
      force.some((c) => c instanceof AlterTableForceRowLevelSecurity),
    ).toBe(true);

    const noforce = diffTables(
      testContext,
      {
        "table:public.t4": new Table({
          ...base,
          name: "t4",
          row_security: true,
          force_row_security: true,
        }),
      },
      {
        "table:public.t4": new Table({
          ...base,
          name: "t4",
          row_security: true,
          force_row_security: false,
        }),
      },
    );
    expect(
      noforce.some((c) => c instanceof AlterTableNoForceRowLevelSecurity),
    ).toBe(true);
  });

  test("replica identity diff emits REPLICA IDENTITY", () => {
    const main = new Table(base);
    const branch = new Table({ ...base, replica_identity: "n" });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetReplicaIdentity)).toBe(
      true,
    );
  });

  test("constraints create/drop/alter and validate", () => {
    const t1 = new Table({ ...base, name: "t1", constraints: [] });
    const pkey = {
      name: "pk_t1",
      constraint_type: "p" as const,
      deferrable: false,
      initially_deferred: false,
      validated: false,
      is_local: true,
      no_inherit: false,
      is_temporal: false,
      is_partition_clone: false,
      parent_constraint_schema: null,
      parent_constraint_name: null,
      parent_table_schema: null,
      parent_table_name: null,
      key_columns: ["a"],
      foreign_key_columns: null,
      foreign_key_table: null,
      foreign_key_schema: null,
      foreign_key_table_is_partition: null,
      foreign_key_parent_schema: null,
      foreign_key_parent_table: null,
      foreign_key_effective_schema: null,
      foreign_key_effective_table: null,
      on_update: null,
      on_delete: null,
      match_type: null,
      check_expression: null,
      owner: "o1",
      definition: "PRIMARY KEY (a)",
    };
    const created = diffTables(
      testContext,
      { [t1.stableId]: t1 },
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
    );
    expect(created.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
    expect(created.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
      false,
    );

    const dropped = diffTables(
      testContext,
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
      { [t1.stableId]: t1 },
    );
    expect(dropped.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );

    const altered = diffTables(
      testContext,
      {
        [t1.stableId]: new Table({ ...base, name: "t1", constraints: [pkey] }),
      },
      {
        [t1.stableId]: new Table({
          ...base,
          name: "t1",
          constraints: [
            {
              ...pkey,
              deferrable: true,
              initially_deferred: true,
              validated: true,
            },
          ],
        }),
      },
    );
    expect(altered.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(altered.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
  });

  test("altered primary key columns triggers drop+add", () => {
    const tMain = new Table({
      ...base,
      name: "t_cols",
      columns: [
        {
          name: "a",
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
          name: "b",
          position: 2,
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
      constraints: [
        {
          name: "pk_cols",
          constraint_type: "p",
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
          key_columns: ["a"],
          foreign_key_columns: null,
          foreign_key_table: null,
          foreign_key_schema: null,
          foreign_key_table_is_partition: null,
          foreign_key_parent_schema: null,
          foreign_key_parent_table: null,
          foreign_key_effective_schema: null,
          foreign_key_effective_table: null,
          on_update: null,
          on_delete: null,
          match_type: null,
          check_expression: null,
          owner: "o1",
          definition: "PRIMARY KEY (a)",
        },
      ],
    });
    const tBranch = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tMain,
      constraints: [
        {
          ...tMain.constraints[0],
          key_columns: ["a", "b"],
        },
      ],
    });
    const changes = diffTables(
      testContext,
      { [tMain.stableId]: tMain },
      { [tBranch.stableId]: tBranch },
    );
    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
  });

  test("altered foreign key to NOT VALID triggers drop+add without validate", () => {
    const tMain = new Table({
      ...base,
      name: "t_fk",
      columns: [
        {
          name: "a",
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
      constraints: [
        {
          name: "fk_a",
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
          key_columns: ["a"],
          foreign_key_columns: ["a"],
          foreign_key_table: "other",
          foreign_key_schema: "public",
          foreign_key_table_is_partition: null,
          foreign_key_parent_schema: null,
          foreign_key_parent_table: null,
          foreign_key_effective_schema: null,
          foreign_key_effective_table: null,
          on_update: "a",
          on_delete: "a",
          match_type: "u",
          check_expression: null,
          owner: "o1",
          definition: "FOREIGN KEY (a) REFERENCES other(a)",
        },
      ],
    });
    const tBranch = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tMain,
      constraints: [
        {
          ...(tMain.constraints[0] as (typeof tMain.constraints)[number]),
          on_delete: "c",
          validated: false,
          definition: "FOREIGN KEY (a) REFERENCES other(a) NOT VALID",
        },
      ],
    });
    const changes = diffTables(
      testContext,
      { [tMain.stableId]: tMain },
      {
        [tBranch.stableId]: tBranch,
        "table:public.other": new Table({
          ...base,
          name: "other",
          columns: [
            {
              name: "a",
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
        }),
      },
    );
    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableValidateConstraint)).toBe(
      false,
    );
  });

  test("altered temporal constraint metadata triggers drop+add", () => {
    const tMain = new Table({
      ...base,
      name: "t_temporal",
      columns: [
        {
          name: "room_id",
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
          name: "booking_period",
          position: 2,
          data_type: "tstzrange",
          data_type_str: "tstzrange",
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
      constraints: [
        {
          name: "bookings_pkey",
          constraint_type: "p",
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
          key_columns: ["room_id", "booking_period"],
          foreign_key_columns: null,
          foreign_key_table: null,
          foreign_key_schema: null,
          foreign_key_table_is_partition: null,
          foreign_key_parent_schema: null,
          foreign_key_parent_table: null,
          foreign_key_effective_schema: null,
          foreign_key_effective_table: null,
          on_update: null,
          on_delete: null,
          match_type: null,
          check_expression: null,
          owner: "o1",
          definition: "PRIMARY KEY (room_id, booking_period)",
        },
      ],
    });
    const tBranch = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tMain,
      constraints: [
        {
          ...tMain.constraints[0],
          is_temporal: true,
          definition: "PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS)",
        },
      ],
    });
    const changes = diffTables(
      testContext,
      { [tMain.stableId]: tMain },
      { [tBranch.stableId]: tBranch },
    );
    expect(changes.some((c) => c instanceof AlterTableDropConstraint)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableAddConstraint)).toBe(
      true,
    );
  });

  test("columns added/dropped/altered (type, default, not null)", () => {
    const main = new Table({ ...base, name: "t2", columns: [] });
    const withCol = new Table({
      ...base,
      name: "t2",
      columns: [
        {
          name: "a",
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
    });
    const added = diffTables(
      testContext,
      { [main.stableId]: main },
      { [withCol.stableId]: withCol },
    );
    expect(added.some((c) => c instanceof AlterTableAddColumn)).toBe(true);

    const dropped = diffTables(
      testContext,
      { [withCol.stableId]: withCol },
      { [main.stableId]: main },
    );
    expect(dropped.some((c) => c instanceof AlterTableDropColumn)).toBe(true);

    const typeChanged = new Table({
      ...base,
      name: "t2",
      columns: [
        {
          ...withCol.columns[0],
          data_type: "text",
          data_type_str: "text",
        },
      ],
    });
    const typeChanges = diffTables(
      testContext,
      { [withCol.stableId]: withCol },
      { [typeChanged.stableId]: typeChanged },
    );
    expect(
      typeChanges.some((c) => c instanceof AlterTableAlterColumnType),
    ).toBe(true);
    expect(typeChanges.map((c) => c.serialize())).toContain(
      "ALTER TABLE public.t2 ALTER COLUMN a TYPE text USING a::text",
    );

    const defaultAdded = new Table({
      ...base,
      name: "t2",
      columns: [{ ...withCol.columns[0], default: "0" }],
    });
    const defaultAddedChanges = diffTables(
      testContext,
      { [withCol.stableId]: withCol },
      { [defaultAdded.stableId]: defaultAdded },
    );
    expect(
      defaultAddedChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(true);

    const defaultDropped = diffTables(
      testContext,
      { [defaultAdded.stableId]: defaultAdded },
      { [withCol.stableId]: withCol },
    );
    expect(
      defaultDropped.some((c) => c instanceof AlterTableAlterColumnDropDefault),
    ).toBe(true);

    const notNullSet = new Table({
      ...base,
      name: "t2",
      columns: [{ ...withCol.columns[0], not_null: true }],
    });
    const notNullSetChanges = diffTables(
      testContext,
      { [withCol.stableId]: withCol },
      { [notNullSet.stableId]: notNullSet },
    );
    expect(
      notNullSetChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetNotNull,
      ),
    ).toBe(true);

    const notNullDropped = diffTables(
      testContext,
      { [notNullSet.stableId]: notNullSet },
      { [withCol.stableId]: withCol },
    );
    expect(
      notNullDropped.some((c) => c instanceof AlterTableAlterColumnDropNotNull),
    ).toBe(true);

    const withDefault = new Table({
      ...base,
      name: "t2",
      columns: [
        {
          ...withCol.columns[0],
          data_type: "text",
          data_type_str: "text",
          default: "'active'",
        },
      ],
    });
    const typeChangedWithDefault = new Table({
      ...base,
      name: "t2",
      columns: [
        {
          ...withDefault.columns[0],
          data_type: "USER-DEFINED",
          data_type_str: "test_schema.status",
          is_custom_type: true,
          custom_type_type: "e",
          custom_type_category: "E",
          custom_type_schema: "test_schema",
          custom_type_name: "status",
          default: "'active'::test_schema.status",
        },
      ],
    });
    const typeChangesWithDefault = diffTables(
      testContext,
      { [withDefault.stableId]: withDefault },
      { [typeChangedWithDefault.stableId]: typeChangedWithDefault },
    );
    expect(typeChangesWithDefault.map((c) => c.serialize())).toEqual([
      "ALTER TABLE public.t2 ALTER COLUMN a DROP DEFAULT",
      "ALTER TABLE public.t2 ALTER COLUMN a TYPE test_schema.status USING a::test_schema.status",
      "ALTER TABLE public.t2 ALTER COLUMN a SET DEFAULT 'active'::test_schema.status",
    ]);
  });

  test("postgres before 17 rebuilds generated columns when their type changes", () => {
    const generatedTextColumn = {
      name: "status_label",
      position: 1,
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
      is_generated: true,
      collation: null,
      default: "upper(status)",
      comment: null,
    };
    const generatedVarcharColumn = {
      ...generatedTextColumn,
      data_type: "character varying",
      data_type_str: "character varying(64)",
    };
    const mainTable = new Table({
      ...base,
      name: "t_generated_type",
      columns: [generatedTextColumn],
    });
    const branchTable = new Table({
      ...base,
      name: "t_generated_type",
      columns: [generatedVarcharColumn],
    });

    const changes = diffTables(
      testContext,
      { [mainTable.stableId]: mainTable },
      { [branchTable.stableId]: branchTable },
    );

    expect(changes.map((change) => change.serialize())).toEqual([
      "ALTER TABLE public.t_generated_type DROP COLUMN status_label",
      "ALTER TABLE public.t_generated_type ADD COLUMN status_label character varying(64) GENERATED ALWAYS AS (upper(status)) STORED",
    ]);
    expect(
      changes.some(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toBe(false);
    expect(
      changes.some((change) => change instanceof AlterTableAlterColumnType),
    ).toBe(false);
    expect(
      changes.some(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(false);
  });

  test("postgres 17 rebuilds constrained generated columns when their type changes", () => {
    const pg17Context = {
      ...testContext,
      version: 170000,
    };
    const generatedTextColumn = {
      name: "status_label",
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
      is_generated: true,
      collation: null,
      default: "upper(status)",
      comment: null,
    };
    const generatedVarcharColumn = {
      ...generatedTextColumn,
      data_type: "character varying",
      data_type_str: "character varying(64)",
    };
    const checkConstraint = {
      name: "t_generated_type_status_label_check",
      constraint_type: "c" as const,
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
      key_columns: ["status_label"],
      foreign_key_columns: null,
      foreign_key_table: null,
      foreign_key_schema: null,
      foreign_key_table_is_partition: null,
      foreign_key_parent_schema: null,
      foreign_key_parent_table: null,
      foreign_key_effective_schema: null,
      foreign_key_effective_table: null,
      on_update: null,
      on_delete: null,
      match_type: null,
      check_expression: "status_label <> ''",
      owner: "o1",
      definition: "CHECK (status_label <> '')",
      comment: null,
    };
    const mainTable = new Table({
      ...base,
      name: "t_generated_type",
      columns: [generatedTextColumn],
      constraints: [checkConstraint],
    });
    const branchTable = new Table({
      ...base,
      name: "t_generated_type",
      columns: [generatedVarcharColumn],
      constraints: [checkConstraint],
    });

    const changes = diffTables(
      pg17Context,
      { [mainTable.stableId]: mainTable },
      { [branchTable.stableId]: branchTable },
    );

    expect(
      changes.some((change) => change instanceof AlterTableDropColumn),
    ).toBe(true);
    expect(
      changes.some((change) => change instanceof AlterTableAddColumn),
    ).toBe(true);
    expect(
      changes.some(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toBe(false);
    expect(
      changes.some((change) => change instanceof AlterTableAlterColumnType),
    ).toBe(false);
    expect(
      changes.some(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(false);
  });

  test("identity transitions emit drop/add/set-generated changes", () => {
    const serialColumn = {
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
      default: "nextval('public.t_identity_id_seq'::regclass)",
      comment: null,
    };

    const identityAlwaysColumn = {
      ...serialColumn,
      is_identity: true,
      is_identity_always: true,
      default: null,
    };

    const identityByDefaultColumn = {
      ...identityAlwaysColumn,
      is_identity_always: false,
    };

    const serialToIdentityMain = new Table({
      ...base,
      name: "t_identity",
      columns: [serialColumn],
    });
    const serialToIdentityBranch = new Table({
      ...base,
      name: "t_identity",
      columns: [identityAlwaysColumn],
    });

    const serialToIdentityChanges = diffTables(
      testContext,
      { [serialToIdentityMain.stableId]: serialToIdentityMain },
      { [serialToIdentityBranch.stableId]: serialToIdentityBranch },
    );
    expect(
      serialToIdentityChanges.some(
        (c) => c instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toBe(true);
    expect(
      serialToIdentityChanges.some(
        (c) => c instanceof AlterTableAlterColumnAddIdentity,
      ),
    ).toBe(true);

    const identityToSerialChanges = diffTables(
      testContext,
      { [serialToIdentityBranch.stableId]: serialToIdentityBranch },
      { [serialToIdentityMain.stableId]: serialToIdentityMain },
    );
    expect(
      identityToSerialChanges.some(
        (c) => c instanceof AlterTableAlterColumnDropIdentity,
      ),
    ).toBe(true);
    expect(
      identityToSerialChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(true);

    const alwaysToByDefaultMain = new Table({
      ...base,
      name: "t_identity_mode",
      columns: [identityAlwaysColumn],
    });
    const alwaysToByDefaultBranch = new Table({
      ...base,
      name: "t_identity_mode",
      columns: [identityByDefaultColumn],
    });
    const alwaysToByDefaultChanges = diffTables(
      testContext,
      { [alwaysToByDefaultMain.stableId]: alwaysToByDefaultMain },
      { [alwaysToByDefaultBranch.stableId]: alwaysToByDefaultBranch },
    );
    expect(
      alwaysToByDefaultChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetGenerated,
      ),
    ).toBe(true);

    const byDefaultToAlwaysMain = new Table({
      ...base,
      name: "t_identity_mode_reverse",
      columns: [identityByDefaultColumn],
    });
    const byDefaultToAlwaysBranch = new Table({
      ...base,
      name: "t_identity_mode_reverse",
      columns: [identityAlwaysColumn],
    });
    const byDefaultToAlwaysChanges = diffTables(
      testContext,
      { [byDefaultToAlwaysMain.stableId]: byDefaultToAlwaysMain },
      { [byDefaultToAlwaysBranch.stableId]: byDefaultToAlwaysBranch },
    );
    expect(
      byDefaultToAlwaysChanges.some(
        (c) => c instanceof AlterTableAlterColumnSetGenerated,
      ),
    ).toBe(true);
  });

  test("postgres 17+ recreates a column when switching from regular to generated", () => {
    const pg17Context = {
      ...testContext,
      version: 170000,
    };

    const regularColumn = {
      name: "confirmed_at",
      position: 1,
      data_type: "timestamp with time zone",
      data_type_str: "timestamp with time zone",
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
    };

    const generatedColumn = {
      ...regularColumn,
      is_generated: true,
      default: "LEAST(email_confirmed_at, phone_confirmed_at)",
    };

    const mainTable = new Table({
      ...base,
      name: "auth_users_like",
      columns: [regularColumn],
    });
    const branchTable = new Table({
      ...base,
      name: "auth_users_like",
      columns: [generatedColumn],
    });

    const changes = diffTables(
      pg17Context,
      { [mainTable.stableId]: mainTable },
      { [branchTable.stableId]: branchTable },
    );

    expect(changes.some((c) => c instanceof AlterTableDropColumn)).toBe(true);
    expect(changes.some((c) => c instanceof AlterTableAddColumn)).toBe(true);
    expect(
      changes.some((c) => c instanceof AlterTableAlterColumnSetDefault),
    ).toBe(false);
  });

  test("created table with privileges emits grant changes", () => {
    const t = new Table({
      ...base,
      privileges: [
        { grantee: "role_sel", privilege: "SELECT", grantable: false },
        { grantee: "role_ins", privilege: "INSERT", grantable: true },
      ],
    });
    const changes = diffTables(testContext, {}, { [t.stableId]: t });
    expect(changes[0]).toBeInstanceOf(CreateTable);
    expect(changes.some((c) => c instanceof GrantTablePrivileges)).toBe(true);
  });

  test("created table with default privilege revoke grant option", () => {
    const defaultPrivilegeState = new DefaultPrivilegeState({});
    defaultPrivilegeState.applyGrant("postgres", "r", "public", "role_a", [
      { privilege: "SELECT", grantable: true },
    ]);
    const ctx = {
      ...testContext,
      defaultPrivilegeState,
    };
    const t = new Table({
      ...base,
      owner: "postgres",
      privileges: [
        { grantee: "role_a", privilege: "SELECT", grantable: false },
      ],
    });
    const changes = diffTables(ctx, {}, { [t.stableId]: t });
    expect(changes[0]).toBeInstanceOf(CreateTable);
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionTablePrivileges),
    ).toBe(true);
  });

  test("altered table privileges emit grant, revoke, and revoke grant option", () => {
    const main = new Table({
      ...base,
      privileges: [
        { grantee: "role_sel", privilege: "SELECT", grantable: false },
        { grantee: "role_with_option", privilege: "SELECT", grantable: true },
        { grantee: "role_removed", privilege: "SELECT", grantable: false },
      ],
    });
    const branch = new Table({
      ...base,
      privileges: [
        { grantee: "role_sel", privilege: "SELECT", grantable: true },
        { grantee: "role_with_option", privilege: "SELECT", grantable: false },
        { grantee: "role_new", privilege: "SELECT", grantable: false },
      ],
    });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof GrantTablePrivileges)).toBe(true);
    expect(changes.some((c) => c instanceof RevokeTablePrivileges)).toBe(true);
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionTablePrivileges),
    ).toBe(true);
  });

  test("altered table privileges emit revokes before grants", () => {
    const main = new Table({
      ...base,
      privileges: [
        { grantee: "authenticated", privilege: "INSERT", grantable: false },
        { grantee: "authenticated", privilege: "UPDATE", grantable: false },
      ],
    });
    const branch = new Table({
      ...base,
      privileges: [
        {
          grantee: "authenticated",
          privilege: "INSERT",
          grantable: false,
          columns: ["org_id", "name"],
        },
        {
          grantee: "authenticated",
          privilege: "UPDATE",
          grantable: false,
          columns: ["name"],
        },
      ],
    });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    const privilegeChanges = changes.filter(
      (c) =>
        c instanceof GrantTablePrivileges ||
        c instanceof RevokeTablePrivileges ||
        c instanceof RevokeGrantOptionTablePrivileges,
    );
    expect(privilegeChanges.length).toBeGreaterThan(1);

    const firstRevokeIndex = privilegeChanges.findIndex(
      (c) => c instanceof RevokeTablePrivileges,
    );
    const firstGrantIndex = privilegeChanges.findIndex(
      (c) => c instanceof GrantTablePrivileges,
    );
    expect(firstRevokeIndex).not.toBe(-1);
    expect(firstGrantIndex).not.toBe(-1);
    expect(firstRevokeIndex).toBeLessThan(firstGrantIndex);
  });

  test("storage params: set when added from null", () => {
    const main = new Table(base);
    const branch = new Table({
      ...base,
      options: ["autovacuum_enabled=false"],
    });
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableSetStorageParams)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableResetStorageParams)).toBe(
      false,
    );
  });

  test("storage params: reset when removed to null", () => {
    const main = new Table({
      ...base,
      options: ["fillfactor=90"],
    });
    const branch = new Table(base);
    const changes = diffTables(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterTableResetStorageParams)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof AlterTableSetStorageParams)).toBe(
      false,
    );
  });
});
