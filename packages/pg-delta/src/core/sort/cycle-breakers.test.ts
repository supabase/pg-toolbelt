import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import {
  AlterPublicationDropTables,
  AlterPublicationSetOwner,
} from "../objects/publication/changes/publication.alter.ts";
import { Publication } from "../objects/publication/publication.model.ts";
import {
  AlterTableDropColumn,
  AlterTableDropConstraint,
} from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import { Table } from "../objects/table/table.model.ts";
import { stableId } from "../objects/utils.ts";
import { tryBreakCycleByChangeInjection } from "./cycle-breakers.ts";

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

function fkConstraint(props: {
  name: string;
  fkColumn: string;
  targetSchema: string;
  targetTable: string;
}) {
  return {
    name: props.name,
    constraint_type: "f" as const,
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
    key_columns: [props.fkColumn],
    foreign_key_columns: ["id"],
    foreign_key_table: props.targetTable,
    foreign_key_schema: props.targetSchema,
    foreign_key_table_is_partition: false,
    foreign_key_parent_schema: null,
    foreign_key_parent_table: null,
    foreign_key_effective_schema: props.targetSchema,
    foreign_key_effective_table: props.targetTable,
    on_update: "a" as const,
    on_delete: "a" as const,
    match_type: "s" as const,
    check_expression: null,
    owner: "postgres",
    definition: `FOREIGN KEY (${props.fkColumn}) REFERENCES ${props.targetSchema}.${props.targetTable}(id)`,
    comment: null,
  };
}

describe("tryBreakCycleByChangeInjection", () => {
  test("FK 2-cycle: injects one constraint drop per FK and updates externallyDroppedConstraints", () => {
    // Schema:
    //   DROP TABLE a; DROP TABLE b;
    //   where a.b_id REFERENCES b, b.a_id REFERENCES a
    // Cycle is over [DropTable(a), DropTable(b)] — both tables drop while
    // their FKs still bind to each other.
    const tableA = new Table({
      ...baseTableProps,
      name: "a",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("b_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "a_b_fkey",
          fkColumn: "b_id",
          targetSchema: "public",
          targetTable: "b",
        }),
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
        fkConstraint({
          name: "b_a_fkey",
          fkColumn: "a_id",
          targetSchema: "public",
          targetTable: "a",
        }),
      ],
    });
    const changes: Change[] = [
      new DropTable({ table: tableA }),
      new DropTable({ table: tableB }),
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1], changes);
    if (broken === null) throw new Error("expected breaker to fire");

    const injectedDrops = broken.filter(
      (change): change is AlterTableDropConstraint =>
        change instanceof AlterTableDropConstraint,
    );
    expect(injectedDrops).toHaveLength(2);
    expect(injectedDrops.map((d) => d.constraint.name).sort()).toEqual([
      "a_b_fkey",
      "b_a_fkey",
    ]);

    const dropA = broken.find(
      (change): change is DropTable =>
        change instanceof DropTable &&
        change.table.stableId === tableA.stableId,
    );
    const dropB = broken.find(
      (change): change is DropTable =>
        change instanceof DropTable &&
        change.table.stableId === tableB.stableId,
    );
    if (!dropA || !dropB) throw new Error("expected both DropTables in result");

    expect(dropA.externallyDroppedConstraints.has("a_b_fkey")).toBe(true);
    expect(dropB.externallyDroppedConstraints.has("b_a_fkey")).toBe(true);
    expect(
      dropA.requires.includes(stableId.constraint("public", "a", "a_b_fkey")),
    ).toBe(false);
    expect(
      dropB.requires.includes(stableId.constraint("public", "b", "b_a_fkey")),
    ).toBe(false);
  });

  test("FK 3-cycle: injects three constraint drops and frees all three tables", () => {
    // Schema:
    //   DROP TABLE a; DROP TABLE b; DROP TABLE c;
    //   where a.b_id REFERENCES b, b.c_id REFERENCES c, c.a_id REFERENCES a
    // No mutual edges — would have stalled the old eager mutual-only
    // breaker. The lazy dispatcher uses the cycle node-set directly.
    const tableA = new Table({
      ...baseTableProps,
      name: "a",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("b_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "a_b_fkey",
          fkColumn: "b_id",
          targetSchema: "public",
          targetTable: "b",
        }),
      ],
    });
    const tableB = new Table({
      ...baseTableProps,
      name: "b",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("c_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "b_c_fkey",
          fkColumn: "c_id",
          targetSchema: "public",
          targetTable: "c",
        }),
      ],
    });
    const tableC = new Table({
      ...baseTableProps,
      name: "c",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("a_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "c_a_fkey",
          fkColumn: "a_id",
          targetSchema: "public",
          targetTable: "a",
        }),
      ],
    });
    const changes: Change[] = [
      new DropTable({ table: tableA }),
      new DropTable({ table: tableB }),
      new DropTable({ table: tableC }),
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1, 2], changes);
    if (broken === null) throw new Error("expected breaker to fire");

    const injectedDrops = broken.filter(
      (change): change is AlterTableDropConstraint =>
        change instanceof AlterTableDropConstraint,
    );
    expect(injectedDrops).toHaveLength(3);
    expect(injectedDrops.map((d) => d.constraint.name).sort()).toEqual([
      "a_b_fkey",
      "b_c_fkey",
      "c_a_fkey",
    ]);

    for (const t of [tableA, tableB, tableC]) {
      const dropChange = broken.find(
        (change): change is DropTable =>
          change instanceof DropTable && change.table.stableId === t.stableId,
      );
      if (!dropChange) throw new Error(`missing DropTable for ${t.name}`);
      expect(dropChange.externallyDroppedConstraints.size).toBe(1);
    }
  });

  test("FK breaker skips when an explicit AlterTableDropConstraint already exists", () => {
    // Diff layer emitted the constraint drop explicitly — breaker shouldn't
    // duplicate it. Returns null (no change to make).
    const tableA = new Table({
      ...baseTableProps,
      name: "a",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("b_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "a_b_fkey",
          fkColumn: "b_id",
          targetSchema: "public",
          targetTable: "b",
        }),
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
        fkConstraint({
          name: "b_a_fkey",
          fkColumn: "a_id",
          targetSchema: "public",
          targetTable: "a",
        }),
      ],
    });
    const changes: Change[] = [
      new AlterTableDropConstraint({
        table: tableA,
        constraint: tableA.constraints[0],
      }),
      new AlterTableDropConstraint({
        table: tableB,
        constraint: tableB.constraints[0],
      }),
      new DropTable({ table: tableA }),
      new DropTable({ table: tableB }),
    ];

    // Cycle reported by sort phase only includes the DropTables (the
    // existing constraint drops are at indices 0 and 1, but the cycle is
    // between the DropTables at 2 and 3).
    const broken = tryBreakCycleByChangeInjection([2, 3], changes);
    expect(broken).toBeNull();
  });

  test("publication-column on surviving table: rebuilds AlterTableDropColumn with omitTableRequirement", () => {
    // Schema:
    //   CREATE PUBLICATION p FOR TABLE labs (id, summary);
    //   ALTER TABLE labs DROP COLUMN summary;
    // Diff:
    //   AlterPublicationDropTables(p, [labs])
    //   AlterTableDropColumn(labs.summary)
    // Cycle: pub→col (catalog) and col→table (explicit requires). `labs`
    // survives; breaker should rewrite the column drop to drop the
    // table-requirement edge.
    const tableLabs = new Table({
      ...baseTableProps,
      name: "labs",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("summary", 2),
      ],
    });
    const summaryColumn = tableLabs.columns.find(
      (column) => column.name === "summary",
    );
    if (!summaryColumn) throw new Error("test setup: summary column missing");

    const publication = new Publication({
      name: "p",
      owner: "postgres",
      comment: null,
      all_tables: false,
      publish_insert: true,
      publish_update: true,
      publish_delete: true,
      publish_truncate: true,
      publish_via_partition_root: false,
      tables: [
        { schema: "public", name: "labs", columns: ["id"], row_filter: null },
      ],
      schemas: [],
    });

    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: [
          {
            schema: "public",
            name: "labs",
            columns: ["id", "summary"],
            row_filter: null,
          },
        ],
      }),
      new AlterTableDropColumn({
        table: tableLabs,
        column: summaryColumn,
      }),
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1], changes);
    if (broken === null) throw new Error("expected breaker to fire");

    const rewrittenDropColumn = broken.find(
      (change): change is AlterTableDropColumn =>
        change instanceof AlterTableDropColumn,
    );
    if (!rewrittenDropColumn) throw new Error("missing AlterTableDropColumn");

    expect(rewrittenDropColumn.omitTableRequirement).toBe(true);
    expect(rewrittenDropColumn.requires.includes(tableLabs.stableId)).toBe(
      false,
    );
    expect(
      rewrittenDropColumn.requires.includes(
        stableId.column("public", "labs", "summary"),
      ),
    ).toBe(true);

    // The publication change passes through untouched.
    expect(broken[0]).toBe(changes[0]);
  });

  test("publication-column when table is also being dropped: returns null (don't interfere)", () => {
    // If `labs` itself is being dropped, the existing structural
    // rewrites in post-diff handle the redundant column drop. Flipping
    // omitTableRequirement here would let the column drop reorder
    // against the table drop and is unsafe.
    const tableLabs = new Table({
      ...baseTableProps,
      name: "labs",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("summary", 2),
      ],
    });
    const summaryColumn = tableLabs.columns.find(
      (column) => column.name === "summary",
    );
    if (!summaryColumn) throw new Error("test setup: summary column missing");
    const publication = new Publication({
      name: "p",
      owner: "postgres",
      comment: null,
      all_tables: false,
      publish_insert: true,
      publish_update: true,
      publish_delete: true,
      publish_truncate: true,
      publish_via_partition_root: false,
      tables: [],
      schemas: [],
    });

    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: [
          {
            schema: "public",
            name: "labs",
            columns: ["id"],
            row_filter: null,
          },
        ],
      }),
      new AlterTableDropColumn({
        table: tableLabs,
        column: summaryColumn,
      }),
      new DropTable({ table: tableLabs }),
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1, 2], changes);
    expect(broken).toBeNull();
  });

  test("returns null for a cycle with no recognised pattern (e.g. publication-only)", () => {
    // Cycle of `AlterPublicationSetOwner` changes — neither FK nor
    // publication-column shape. Breaker must bail so the formatted
    // CycleError surfaces instead of an unsafe rewrite.
    const publication = new Publication({
      name: "p",
      owner: "postgres",
      comment: null,
      all_tables: false,
      publish_insert: true,
      publish_update: true,
      publish_delete: true,
      publish_truncate: true,
      publish_via_partition_root: false,
      tables: [],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterPublicationSetOwner({ publication, owner: "alice" }),
      new AlterPublicationSetOwner({ publication, owner: "bob" }),
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1], changes);
    expect(broken).toBeNull();
  });
});
