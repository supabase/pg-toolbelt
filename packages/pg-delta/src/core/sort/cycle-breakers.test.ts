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
  targetColumn?: string;
}) {
  const targetColumn = props.targetColumn ?? "id";
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
    foreign_key_columns: [targetColumn],
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
    definition: `FOREIGN KEY (${props.fkColumn}) REFERENCES ${props.targetSchema}.${props.targetTable}(${targetColumn})`,
    comment: null,
  };
}

function uniqueConstraint(name: string, column: string) {
  return {
    name,
    constraint_type: "u" as const,
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
    key_columns: [column],
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
    owner: "postgres",
    definition: `UNIQUE (${column})`,
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

  test("publication FK-chain constraint-drop 3-cycle: injects terminal FK drop", () => {
    // Schema:
    //   publication p includes labs and posts
    //   posts.lab_id REFERENCES labs(id)
    // Diff drops posts and drops labs.unique_lab_id while also removing both
    // tables from the publication. The FK edge from posts to the terminal
    // constraint drop forms:
    //   AlterPublicationDropTables → DropTable(posts)
    //   DropTable(posts) → AlterTableDropConstraint(labs.unique_lab_id)
    //   AlterTableDropConstraint(labs.unique_lab_id) → AlterPublicationDropTables
    const tableLabs = new Table({
      ...baseTableProps,
      name: "labs",
      columns: [{ ...integerColumn("id", 1), not_null: true }],
      constraints: [uniqueConstraint("unique_lab_id", "id")],
    });
    const tablePosts = new Table({
      ...baseTableProps,
      name: "posts",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("lab_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "posts_lab_id_fkey",
          fkColumn: "lab_id",
          targetSchema: "public",
          targetTable: "labs",
        }),
      ],
    });
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
        { schema: "public", name: "labs", columns: null, row_filter: null },
        { schema: "public", name: "posts", columns: null, row_filter: null },
      ],
      schemas: [],
    });

    const terminalDrop = new AlterTableDropConstraint({
      table: tableLabs,
      constraint: tableLabs.constraints[0],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: tablePosts }),
      terminalDrop,
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1, 2], changes);
    if (broken === null) throw new Error("expected breaker to fire");

    const injectedDrops = broken.filter(
      (change): change is AlterTableDropConstraint =>
        change instanceof AlterTableDropConstraint &&
        change.table.stableId === tablePosts.stableId,
    );
    expect(injectedDrops).toHaveLength(1);
    expect(injectedDrops[0].constraint.name).toBe("posts_lab_id_fkey");

    const rewrittenPostsDrop = broken.find(
      (change): change is DropTable =>
        change instanceof DropTable &&
        change.table.stableId === tablePosts.stableId,
    );
    if (!rewrittenPostsDrop) throw new Error("missing rewritten DropTable");
    expect(
      rewrittenPostsDrop.externallyDroppedConstraints.has("posts_lab_id_fkey"),
    ).toBe(true);
    expect(broken).toContain(terminalDrop);
  });

  test("publication FK-chain constraint-drop 4-cycle: injects FK drops along the dropped-table chain", () => {
    // Schema:
    //   publication p includes labs, posts, and post_attachments
    //   post_attachments.post_id REFERENCES posts(id)
    //   posts.lab_id REFERENCES labs(id)
    // Diff drops post_attachments and posts, drops labs.unique_lab_id,
    // and removes all three tables from the publication.
    const tableLabs = new Table({
      ...baseTableProps,
      name: "labs",
      columns: [{ ...integerColumn("id", 1), not_null: true }],
      constraints: [uniqueConstraint("unique_lab_id", "id")],
    });
    const tablePosts = new Table({
      ...baseTableProps,
      name: "posts",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("lab_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "posts_lab_id_fkey",
          fkColumn: "lab_id",
          targetSchema: "public",
          targetTable: "labs",
        }),
      ],
    });
    const tablePostAttachments = new Table({
      ...baseTableProps,
      name: "post_attachments",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("post_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "post_attachments_post_id_fkey",
          fkColumn: "post_id",
          targetSchema: "public",
          targetTable: "posts",
        }),
      ],
    });
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
        { schema: "public", name: "labs", columns: null, row_filter: null },
        {
          schema: "public",
          name: "post_attachments",
          columns: null,
          row_filter: null,
        },
        { schema: "public", name: "posts", columns: null, row_filter: null },
      ],
      schemas: [],
    });

    const terminalDrop = new AlterTableDropConstraint({
      table: tableLabs,
      constraint: tableLabs.constraints[0],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: tablePostAttachments }),
      new DropTable({ table: tablePosts }),
      terminalDrop,
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1, 2, 3], changes);
    if (broken === null) throw new Error("expected breaker to fire");

    const injectedDropNames = broken
      .filter(
        (change): change is AlterTableDropConstraint =>
          change instanceof AlterTableDropConstraint && change !== terminalDrop,
      )
      .map((change) => change.constraint.name)
      .sort();
    expect(injectedDropNames).toEqual([
      "post_attachments_post_id_fkey",
      "posts_lab_id_fkey",
    ]);

    for (const [tableId, constraintName] of [
      [tablePostAttachments.stableId, "post_attachments_post_id_fkey"],
      [tablePosts.stableId, "posts_lab_id_fkey"],
    ] as const) {
      const rewrittenDrop = broken.find(
        (change): change is DropTable =>
          change instanceof DropTable && change.table.stableId === tableId,
      );
      if (!rewrittenDrop) throw new Error(`missing DropTable for ${tableId}`);
      expect(
        rewrittenDrop.externallyDroppedConstraints.has(constraintName),
      ).toBe(true);
    }
    expect(broken).toContain(terminalDrop);
  });

  test("publication FK-chain 4-cycle with partial publication membership: injects FK drops", () => {
    // Sentry SUPABASE-API-7RS / CLI-1605. Same shape as the previous test,
    // but the publication only contains the terminal constraint's table
    // (trades) and the first dropped table (public_offering_events) — the
    // intermediate FK-chain table (trade_status_events) was never a member
    // of supabase_realtime. The breaker must not require every dropped
    // table in the cycle to be a publication member; the pub edge only
    // needs one of them.
    //
    // Schema:
    //   trades.trade_id UNIQUE (trades_trade_id_key) — table survives
    //   trade_status_events.trade_id REFERENCES trades(trade_id)
    //   public_offering_events.source_event_id REFERENCES trade_status_events(id)
    //   publication supabase_realtime: trades, public_offering_events only
    const tableTrades = new Table({
      ...baseTableProps,
      name: "trades",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        { ...integerColumn("trade_id", 2), not_null: true },
      ],
      constraints: [uniqueConstraint("trades_trade_id_key", "trade_id")],
    });
    const tableTradeStatusEvents = new Table({
      ...baseTableProps,
      name: "trade_status_events",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("trade_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "trade_status_events_trade_id_fkey",
          fkColumn: "trade_id",
          targetSchema: "public",
          targetTable: "trades",
          targetColumn: "trade_id",
        }),
      ],
    });
    const tablePublicOfferingEvents = new Table({
      ...baseTableProps,
      name: "public_offering_events",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("source_event_id", 2),
      ],
      constraints: [
        fkConstraint({
          name: "public_offering_events_source_event_id_fkey",
          fkColumn: "source_event_id",
          targetSchema: "public",
          targetTable: "trade_status_events",
        }),
      ],
    });
    const publication = new Publication({
      name: "supabase_realtime",
      owner: "postgres",
      comment: null,
      all_tables: false,
      publish_insert: true,
      publish_update: true,
      publish_delete: true,
      publish_truncate: true,
      publish_via_partition_root: false,
      tables: [
        {
          schema: "public",
          name: "public_offering_events",
          columns: null,
          row_filter: null,
        },
        { schema: "public", name: "trades", columns: null, row_filter: null },
      ],
      schemas: [],
    });

    const terminalDrop = new AlterTableDropConstraint({
      table: tableTrades,
      constraint: tableTrades.constraints[0],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: tablePublicOfferingEvents }),
      new DropTable({ table: tableTradeStatusEvents }),
      terminalDrop,
    ];

    const broken = tryBreakCycleByChangeInjection([0, 1, 2, 3], changes);
    if (broken === null) throw new Error("expected breaker to fire");

    const injectedDropNames = broken
      .filter(
        (change): change is AlterTableDropConstraint =>
          change instanceof AlterTableDropConstraint && change !== terminalDrop,
      )
      .map((change) => change.constraint.name)
      .sort();
    expect(injectedDropNames).toEqual([
      "public_offering_events_source_event_id_fkey",
      "trade_status_events_trade_id_fkey",
    ]);

    for (const [tableId, constraintName] of [
      [
        tablePublicOfferingEvents.stableId,
        "public_offering_events_source_event_id_fkey",
      ],
      [tableTradeStatusEvents.stableId, "trade_status_events_trade_id_fkey"],
    ] as const) {
      const rewrittenDrop = broken.find(
        (change): change is DropTable =>
          change instanceof DropTable && change.table.stableId === tableId,
      );
      if (!rewrittenDrop) throw new Error(`missing DropTable for ${tableId}`);
      expect(
        rewrittenDrop.externallyDroppedConstraints.has(constraintName),
      ).toBe(true);
    }
    expect(broken).toContain(terminalDrop);
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
