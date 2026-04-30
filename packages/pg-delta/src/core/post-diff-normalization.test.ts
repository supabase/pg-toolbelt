import { describe, expect, test } from "bun:test";
import type { Change } from "./change.types.ts";
import { CreateIndex } from "./objects/index/changes/index.create.ts";
import { DropIndex } from "./objects/index/changes/index.drop.ts";
import { Index, type IndexProps } from "./objects/index/index.model.ts";
import {
  AlterTableAddConstraint,
  AlterTableChangeOwner,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableSetReplicaIdentity,
  AlterTableValidateConstraint,
} from "./objects/table/changes/table.alter.ts";
import { CreateCommentOnConstraint } from "./objects/table/changes/table.comment.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { GrantTablePrivileges } from "./objects/table/changes/table.privilege.ts";
import { Table } from "./objects/table/table.model.ts";
import { normalizePostDiffChanges } from "./post-diff-normalization.ts";

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

describe("normalizePostDiffChanges", () => {
  test("prunes same-table drop-column and drop-constraint ALTERs for replaced tables only", async () => {
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
      new DropTable({ table: mainChildren }),
      new CreateTable({ table: branchChildren }),
      preExistingDropColumn,
      preExistingDropConstraint,
      preExistingChangeOwner,
      preExistingEnableRls,
      preExistingReplicaIdentity,
      preExistingGrant,
    ];

    const normalized = normalizePostDiffChanges({
      changes,
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

  test("dedupes duplicate constraint Add/Validate/Comment on replaced tables keeping last occurrence", async () => {
    const branchChildren = new Table({
      ...baseTableProps,
      name: "children",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("parent_ref", 2),
      ],
    });
    const otherTable = new Table({
      ...baseTableProps,
      name: "other",
      columns: [{ ...integerColumn("id", 1), not_null: true }],
    });

    const fkConstraint = {
      name: "children_parent_ref_fkey",
      constraint_type: "f" as const,
      deferrable: false,
      initially_deferred: false,
      validated: false,
      is_local: true,
      no_inherit: false,
      is_temporal: true,
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
      on_update: "a" as const,
      on_delete: "a" as const,
      match_type: "s" as const,
      check_expression: null,
      owner: "postgres",
      definition:
        "FOREIGN KEY (parent_ref, PERIOD valid_period) REFERENCES public.parents(id, PERIOD valid_period)",
      comment: "fk comment",
    };
    const otherConstraint = {
      ...fkConstraint,
      name: "other_unique",
      constraint_type: "u" as const,
      foreign_key_table: null,
      foreign_key_schema: null,
      foreign_key_effective_schema: null,
      foreign_key_effective_table: null,
      foreign_key_columns: [],
      key_columns: ["id"],
      definition: "UNIQUE (id)",
    };

    const diffTablesAdd = new AlterTableAddConstraint({
      table: branchChildren,
      constraint: fkConstraint,
    });
    const diffTablesValidate = new AlterTableValidateConstraint({
      table: branchChildren,
      constraint: fkConstraint,
    });
    const diffTablesComment = new CreateCommentOnConstraint({
      table: branchChildren,
      constraint: fkConstraint,
    });
    const expansionAdd = new AlterTableAddConstraint({
      table: branchChildren,
      constraint: fkConstraint,
    });
    const expansionValidate = new AlterTableValidateConstraint({
      table: branchChildren,
      constraint: fkConstraint,
    });
    const expansionComment = new CreateCommentOnConstraint({
      table: branchChildren,
      constraint: fkConstraint,
    });
    const soloOtherTableAdd = new AlterTableAddConstraint({
      table: otherTable,
      constraint: otherConstraint,
    });

    const changes: Change[] = [
      new DropTable({ table: branchChildren }),
      new CreateTable({ table: branchChildren }),
      diffTablesAdd,
      diffTablesValidate,
      diffTablesComment,
      soloOtherTableAdd,
      expansionAdd,
      expansionValidate,
      expansionComment,
    ];

    const normalized = normalizePostDiffChanges({
      changes,
      replacedTableIds: new Set([branchChildren.stableId]),
    });

    expect(normalized).not.toContain(diffTablesAdd);
    expect(normalized).not.toContain(diffTablesValidate);
    expect(normalized).not.toContain(diffTablesComment);
    expect(normalized).toContain(expansionAdd);
    expect(normalized).toContain(expansionValidate);
    expect(normalized).toContain(expansionComment);
    expect(normalized).toContain(soloOtherTableAdd);

    expect(
      normalized.filter((change) => change instanceof AlterTableAddConstraint),
    ).toHaveLength(2);
    expect(
      normalized.filter(
        (change) => change instanceof AlterTableValidateConstraint,
      ),
    ).toHaveLength(1);
    expect(
      normalized.filter(
        (change) => change instanceof CreateCommentOnConstraint,
      ),
    ).toHaveLength(1);
  });

  describe("restoreReplicaIdentityAfterIndexReplace", () => {
    const baseIndexProps: IndexProps = {
      schema: "public",
      table_name: "replicated",
      name: "tenant_idx",
      storage_params: [],
      statistics_target: [],
      index_type: "btree",
      tablespace: null,
      is_unique: true,
      is_primary: false,
      is_exclusion: false,
      nulls_not_distinct: false,
      immediate: true,
      is_clustered: false,
      is_replica_identity: true,
      key_columns: [],
      column_collations: [],
      operator_classes: [],
      column_options: [],
      index_expressions: null,
      partial_predicate: null,
      table_relkind: "r",
      is_owned_by_constraint: false,
      is_partitioned_index: false,
      is_index_partition: false,
      parent_index_name: null,
      definition: "CREATE UNIQUE INDEX tenant_idx ON public.replicated (a)",
      comment: null,
      owner: "postgres",
    };

    function makeBranchTable(replicaIdentityIndex: string | null) {
      return new Table({
        ...baseTableProps,
        name: "replicated",
        replica_identity: replicaIdentityIndex ? "i" : "d",
        replica_identity_index: replicaIdentityIndex,
        columns: [
          { ...integerColumn("id", 1), not_null: true },
          integerColumn("a", 2),
        ],
      });
    }

    test("re-emits ALTER TABLE … REPLICA IDENTITY USING INDEX after a DropIndex+CreateIndex pair", () => {
      const branchTable = makeBranchTable("tenant_idx");
      const oldIndex = new Index(baseIndexProps);
      const newIndex = new Index({
        ...baseIndexProps,
        definition:
          "CREATE UNIQUE INDEX tenant_idx ON public.replicated (a, id)",
      });

      const changes: Change[] = [
        new DropIndex({ index: oldIndex }),
        new CreateIndex({ index: newIndex, indexableObject: branchTable }),
      ];

      const normalized = normalizePostDiffChanges({
        changes,
        branchTables: { [branchTable.stableId]: branchTable },
      });

      expect(normalized.map((c) => c.constructor.name)).toEqual([
        "DropIndex",
        "CreateIndex",
        "AlterTableSetReplicaIdentity",
      ]);

      const inserted = normalized[2] as AlterTableSetReplicaIdentity;
      expect(inserted.mode).toBe("i");
      expect(inserted.indexName).toBe("tenant_idx");
      expect(inserted.requires).toEqual([
        "table:public.replicated",
        "index:public.replicated.tenant_idx",
      ]);
    });

    test("does not double-emit when diffTables already produced an AlterTableSetReplicaIdentity for the same table", () => {
      const branchTable = makeBranchTable("tenant_idx");
      const oldIndex = new Index(baseIndexProps);
      const newIndex = new Index({
        ...baseIndexProps,
        definition:
          "CREATE UNIQUE INDEX tenant_idx ON public.replicated (a, id)",
      });

      const changes: Change[] = [
        new DropIndex({ index: oldIndex }),
        new CreateIndex({ index: newIndex, indexableObject: branchTable }),
        new AlterTableSetReplicaIdentity({
          table: branchTable,
          mode: "i",
          indexName: "tenant_idx",
        }),
      ];

      const normalized = normalizePostDiffChanges({
        changes,
        branchTables: { [branchTable.stableId]: branchTable },
      });

      expect(
        normalized.filter((c) => c instanceof AlterTableSetReplicaIdentity),
      ).toHaveLength(1);
    });

    test("ignores DropIndex without a matching CreateIndex (pure drop)", () => {
      // Pure drop: the user removed the index entirely. The table.diff path is
      // responsible for emitting the corresponding REPLICA IDENTITY DEFAULT.
      // The post-diff pass must not synthesize a USING INDEX setter for an
      // index that no longer exists.
      const branchTable = makeBranchTable(null);
      const oldIndex = new Index(baseIndexProps);

      const changes: Change[] = [new DropIndex({ index: oldIndex })];

      const normalized = normalizePostDiffChanges({
        changes,
        branchTables: { [branchTable.stableId]: branchTable },
      });

      expect(
        normalized.filter((c) => c instanceof AlterTableSetReplicaIdentity),
      ).toHaveLength(0);
    });

    test("ignores indexes that are not the table's replica identity", () => {
      // The table has replica_identity = 'd', so even if some other index is
      // being replaced, no setter should be injected.
      const branchTable = makeBranchTable(null);
      const otherIndex = new Index({
        ...baseIndexProps,
        name: "some_other_idx",
        is_replica_identity: false,
        definition: "CREATE INDEX some_other_idx ON public.replicated (a)",
      });
      const newOtherIndex = new Index({
        ...baseIndexProps,
        name: "some_other_idx",
        is_replica_identity: false,
        definition: "CREATE INDEX some_other_idx ON public.replicated (a, id)",
      });

      const changes: Change[] = [
        new DropIndex({ index: otherIndex }),
        new CreateIndex({ index: newOtherIndex, indexableObject: branchTable }),
      ];

      const normalized = normalizePostDiffChanges({
        changes,
        branchTables: { [branchTable.stableId]: branchTable },
      });

      expect(
        normalized.filter((c) => c instanceof AlterTableSetReplicaIdentity),
      ).toHaveLength(0);
    });
  });
});
