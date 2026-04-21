import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import {
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
import { stableId } from "./objects/utils.ts";
import { normalizePostDiffCycles } from "./post-diff-cycle-breaking.ts";

const baseTableProps = {
  schema: "public",
  persistence: "p" as const,
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
  partition_by: null,
  owner: "postgres",
  comment: null,
  parent_schema: null,
  parent_name: null,
  privileges: [],
};

function integerColumn(name: string, position: number) {
  return {
    name,
    position,
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
}

describe("normalizePostDiffCycles", () => {
  test("injects explicit FK drops for mutually dependent dropped tables", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const tableA = new Table({
      ...baseTableProps,
      name: "a",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("b_id", 2),
      ],
      constraints: [
        {
          name: "a_b_fkey",
          constraint_type: "f",
          deferrable: false,
          initially_deferred: false,
          validated: true,
          is_local: true,
          no_inherit: false,
          is_partition_clone: false,
          parent_constraint_schema: null,
          parent_constraint_name: null,
          parent_table_schema: null,
          parent_table_name: null,
          key_columns: ["b_id"],
          foreign_key_columns: ["id"],
          foreign_key_table: "b",
          foreign_key_schema: "public",
          foreign_key_table_is_partition: false,
          foreign_key_parent_schema: null,
          foreign_key_parent_table: null,
          foreign_key_effective_schema: "public",
          foreign_key_effective_table: "b",
          on_update: "a",
          on_delete: "a",
          match_type: "s",
          check_expression: null,
          owner: "postgres",
          definition: "FOREIGN KEY (b_id) REFERENCES public.b(id)",
          comment: null,
        },
      ],
    });
    const tableB = new Table({
      ...baseTableProps,
      name: "b",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("a_id", 2),
      ],
      constraints: [
        {
          name: "b_a_fkey",
          constraint_type: "f",
          deferrable: false,
          initially_deferred: false,
          validated: true,
          is_local: true,
          no_inherit: false,
          is_partition_clone: false,
          parent_constraint_schema: null,
          parent_constraint_name: null,
          parent_table_schema: null,
          parent_table_name: null,
          key_columns: ["a_id"],
          foreign_key_columns: ["id"],
          foreign_key_table: "a",
          foreign_key_schema: "public",
          foreign_key_table_is_partition: false,
          foreign_key_parent_schema: null,
          foreign_key_parent_table: null,
          foreign_key_effective_schema: "public",
          foreign_key_effective_table: "a",
          on_update: "a",
          on_delete: "a",
          match_type: "s",
          check_expression: null,
          owner: "postgres",
          definition: "FOREIGN KEY (a_id) REFERENCES public.a(id)",
          comment: null,
        },
      ],
    });
    const mainCatalog = new Catalog({
      ...baseline,
      tables: {
        [tableA.stableId]: tableA,
        [tableB.stableId]: tableB,
      },
    });
    const changes: Change[] = [
      new DropTable({ table: tableA }),
      new DropTable({ table: tableB }),
    ];

    const normalized = normalizePostDiffCycles({
      changes,
      mainCatalog,
    });

    const explicitConstraintDrops = normalized.filter(
      (change) => change instanceof AlterTableDropConstraint,
    );
    expect(explicitConstraintDrops).toHaveLength(2);

    const normalizedDropTableA = normalized.find(
      (change) =>
        change instanceof DropTable &&
        change.table.stableId === tableA.stableId,
    );
    const normalizedDropTableB = normalized.find(
      (change) =>
        change instanceof DropTable &&
        change.table.stableId === tableB.stableId,
    );
    if (!(normalizedDropTableA instanceof DropTable)) {
      throw new Error("expected normalized DropTable(public.a)");
    }
    if (!(normalizedDropTableB instanceof DropTable)) {
      throw new Error("expected normalized DropTable(public.b)");
    }

    expect(
      normalizedDropTableA.externallyDroppedConstraints.has("a_b_fkey"),
    ).toBe(true);
    expect(
      normalizedDropTableB.externallyDroppedConstraints.has("b_a_fkey"),
    ).toBe(true);
    expect(
      normalizedDropTableA.requires.includes(
        stableId.constraint("public", "a", "a_b_fkey"),
      ),
    ).toBe(false);
    expect(
      normalizedDropTableB.requires.includes(
        stableId.constraint("public", "b", "b_a_fkey"),
      ),
    ).toBe(false);
  });

  test("prunes same-table drop-column and drop-constraint ALTERs for replaced tables only", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainChildren = new Table({
      ...baseTableProps,
      name: "children",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("parent_ref", 2),
        integerColumn("status", 3),
      ],
    });
    const branchChildren = new Table({
      ...baseTableProps,
      name: "children",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("status", 2),
      ],
    });

    const droppedColumn = mainChildren.columns.find(
      (column) => column.name === "parent_ref",
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
      new DropTable({ table: mainChildren }),
      new CreateTable({ table: branchChildren }),
      preExistingDropColumn,
      preExistingDropConstraint,
      preExistingChangeOwner,
      preExistingEnableRls,
      preExistingReplicaIdentity,
      preExistingGrant,
    ];
    const mainCatalog = new Catalog({
      ...baseline,
      tables: { [mainChildren.stableId]: mainChildren },
    });

    const normalized = normalizePostDiffCycles({
      changes,
      mainCatalog,
      replacedTableIds: new Set([mainChildren.stableId]),
    });

    expect(normalized.some((change) => change instanceof DropTable)).toBe(true);
    expect(normalized.some((change) => change instanceof CreateTable)).toBe(
      true,
    );
    expect(normalized).not.toContain(preExistingDropColumn);
    expect(normalized).not.toContain(preExistingDropConstraint);
    expect(
      normalized.some((change) => change instanceof AlterTableDropColumn),
    ).toBe(false);
    expect(
      normalized.some((change) => change instanceof AlterTableDropConstraint),
    ).toBe(false);
    expect(normalized).toContain(preExistingChangeOwner);
    expect(normalized).toContain(preExistingEnableRls);
    expect(normalized).toContain(preExistingReplicaIdentity);
    expect(normalized).toContain(preExistingGrant);
  });
});
