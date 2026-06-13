import { describe, expect, test } from "bun:test";
import type { Change } from "./change.types.ts";
import { CreateIndex } from "./objects/index/changes/index.create.ts";
import { DropIndex } from "./objects/index/changes/index.drop.ts";
import { Index, type IndexProps } from "./objects/index/index.model.ts";
import { CreateSequence } from "./objects/sequence/changes/sequence.create.ts";
import { DropSequence } from "./objects/sequence/changes/sequence.drop.ts";
import {
  Sequence,
  type SequenceProps,
} from "./objects/sequence/sequence.model.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnAddIdentity,
  AlterTableAlterColumnDropIdentity,
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

  test("dedupes table owner restores for replaced tables with last replacement replay winning", () => {
    const mainTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [integerColumn("id", 1)],
      owner: "postgres",
    });
    const branchTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [integerColumn("id", 1)],
      owner: "app_owner",
    });

    const preExistingOwnerRestore = new AlterTableChangeOwner({
      table: mainTable,
      owner: "app_owner",
    });
    const replacementOwnerRestore = new AlterTableChangeOwner({
      table: branchTable,
      owner: "app_owner",
    });
    const normalized = normalizePostDiffChanges({
      changes: [
        preExistingOwnerRestore,
        new DropTable({ table: mainTable }),
        new CreateTable({ table: branchTable }),
        replacementOwnerRestore,
      ],
      replacedTableIds: new Set([mainTable.stableId]),
    });
    const ownerRestores = normalized.filter(
      (change): change is AlterTableChangeOwner =>
        change instanceof AlterTableChangeOwner,
    );

    expect(ownerRestores).toEqual([replacementOwnerRestore]);
  });

  test("prunes same-table add-column ALTERs for replaced tables only", () => {
    const mainTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [integerColumn("id", 1)],
    });
    const branchTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [integerColumn("id", 1), integerColumn("slug", 2)],
    });
    const otherTable = new Table({
      ...baseTableProps,
      name: "other_items",
      columns: [integerColumn("id", 1), integerColumn("slug", 2)],
    });

    const replacedTableAddColumn = new AlterTableAddColumn({
      table: branchTable,
      column: branchTable.columns[1],
    });
    const unrelatedAddColumn = new AlterTableAddColumn({
      table: otherTable,
      column: otherTable.columns[1],
    });

    const normalized = normalizePostDiffChanges({
      changes: [
        new DropTable({ table: mainTable }),
        new CreateTable({ table: branchTable }),
        replacedTableAddColumn,
        unrelatedAddColumn,
      ],
      replacedTableIds: new Set([mainTable.stableId]),
    });

    expect(normalized).not.toContain(replacedTableAddColumn);
    expect(normalized).toContain(unrelatedAddColumn);
    expect(
      normalized.filter((change) => change instanceof AlterTableAddColumn),
    ).toEqual([unrelatedAddColumn]);
  });

  test("prunes same-table identity-add ALTERs for replaced tables only", () => {
    const mainTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [integerColumn("id", 1)],
    });
    const branchTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [
        {
          ...integerColumn("id", 1),
          is_identity: true,
          is_identity_always: true,
        },
      ],
    });
    const otherTable = new Table({
      ...baseTableProps,
      name: "other_items",
      columns: [
        {
          ...integerColumn("id", 1),
          is_identity: true,
          is_identity_always: true,
        },
      ],
    });

    const replacedTableAddIdentity = new AlterTableAlterColumnAddIdentity({
      table: branchTable,
      column: branchTable.columns[0],
    });
    const unrelatedAddIdentity = new AlterTableAlterColumnAddIdentity({
      table: otherTable,
      column: otherTable.columns[0],
    });

    const normalized = normalizePostDiffChanges({
      changes: [
        new DropTable({ table: mainTable }),
        new CreateTable({ table: branchTable }),
        replacedTableAddIdentity,
        unrelatedAddIdentity,
      ],
      replacedTableIds: new Set([mainTable.stableId]),
    });

    expect(normalized).not.toContain(replacedTableAddIdentity);
    expect(normalized).toContain(unrelatedAddIdentity);
    expect(
      normalized.filter(
        (change) => change instanceof AlterTableAlterColumnAddIdentity,
      ),
    ).toEqual([unrelatedAddIdentity]);
  });

  test("prunes same-table identity-drop ALTERs for replaced tables only", () => {
    const mainTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [
        {
          ...integerColumn("id", 1),
          is_identity: true,
          is_identity_always: true,
        },
      ],
    });
    const branchTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [integerColumn("id", 1)],
    });
    const otherTable = new Table({
      ...baseTableProps,
      name: "other_items",
      columns: [
        {
          ...integerColumn("id", 1),
          is_identity: true,
          is_identity_always: true,
        },
      ],
    });

    const replacedTableDropIdentity = new AlterTableAlterColumnDropIdentity({
      table: mainTable,
      column: mainTable.columns[0],
    });
    const unrelatedDropIdentity = new AlterTableAlterColumnDropIdentity({
      table: otherTable,
      column: otherTable.columns[0],
    });

    const normalized = normalizePostDiffChanges({
      changes: [
        new DropTable({ table: mainTable }),
        new CreateTable({ table: branchTable }),
        replacedTableDropIdentity,
        unrelatedDropIdentity,
      ],
      replacedTableIds: new Set([mainTable.stableId]),
    });

    expect(normalized).not.toContain(replacedTableDropIdentity);
    expect(normalized).toContain(unrelatedDropIdentity);
    expect(
      normalized.filter(
        (change) => change instanceof AlterTableAlterColumnDropIdentity,
      ),
    ).toEqual([unrelatedDropIdentity]);
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

  describe("DropSequence pruning on replaced tables", () => {
    const baseSequenceProps: SequenceProps = {
      schema: "public",
      name: "project_link_type_id_seq",
      data_type: "integer",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 2147483647n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: "public",
      owned_by_table: "project_link_type",
      owned_by_column: "id",
      comment: null,
      privileges: [],
      owner: "postgres",
    };

    test("prunes DropSequence when its OWNED BY table is in replacedTableIds", () => {
      const replacedTable = new Table({
        ...baseTableProps,
        name: "project_link_type",
        columns: [{ ...integerColumn("id", 1), not_null: true }],
      });
      const ownedSequence = new Sequence(baseSequenceProps);

      const dropSequence = new DropSequence({ sequence: ownedSequence });
      const dropTable = new DropTable({ table: replacedTable });
      const createTable = new CreateTable({ table: replacedTable });

      const changes: Change[] = [dropSequence, dropTable, createTable];

      const normalized = normalizePostDiffChanges({
        changes,
        replacedTableIds: new Set([replacedTable.stableId]),
      });

      expect(normalized.some((change) => change instanceof DropSequence)).toBe(
        false,
      );
      expect(normalized).toContain(dropTable);
      expect(normalized).toContain(createTable);
    });

    test("keeps DropSequence whose OWNED BY table is not in replacedTableIds", () => {
      const survivingTable = new Table({
        ...baseTableProps,
        name: "project_link_type",
        columns: [{ ...integerColumn("id", 1), not_null: true }],
      });
      const ownedSequence = new Sequence(baseSequenceProps);

      const dropSequence = new DropSequence({ sequence: ownedSequence });

      const normalized = normalizePostDiffChanges({
        changes: [dropSequence],
        // Different table is being replaced; the sequence's OWNED BY does
        // not match, so DropSequence must survive.
        replacedTableIds: new Set([
          `table:${survivingTable.schema}.unrelated_table` as const,
        ]),
      });

      expect(normalized).toContain(dropSequence);
    });

    test("keeps DropSequence with no OWNED BY when replacedTableIds is non-empty", () => {
      const orphanSequence = new Sequence({
        ...baseSequenceProps,
        owned_by_schema: null,
        owned_by_table: null,
        owned_by_column: null,
      });

      const dropSequence = new DropSequence({ sequence: orphanSequence });

      const normalized = normalizePostDiffChanges({
        changes: [dropSequence],
        replacedTableIds: new Set(["table:public.project_link_type" as const]),
      });

      expect(normalized).toContain(dropSequence);
    });

    test("keeps unrelated CreateSequence and DropSequence even when its non-owning table is replaced", () => {
      const sequenceA = new Sequence(baseSequenceProps);
      const sequenceB = new Sequence({
        ...baseSequenceProps,
        name: "unrelated_seq",
        owned_by_schema: null,
        owned_by_table: null,
        owned_by_column: null,
      });

      const dropOwned = new DropSequence({ sequence: sequenceA });
      const createUnrelated = new CreateSequence({ sequence: sequenceB });

      const replacedTable = new Table({
        ...baseTableProps,
        name: "project_link_type",
        columns: [{ ...integerColumn("id", 1), not_null: true }],
      });

      const normalized = normalizePostDiffChanges({
        changes: [dropOwned, createUnrelated],
        replacedTableIds: new Set([replacedTable.stableId]),
      });

      expect(normalized.some((change) => change instanceof DropSequence)).toBe(
        false,
      );
      expect(normalized).toContain(createUnrelated);
    });
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
