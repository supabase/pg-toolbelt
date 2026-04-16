import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Table } from "../table.model.ts";
import { DropTableChange } from "./table.base.ts";

/**
 * Drop a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptable.html
 *
 * Synopsis
 * ```sql
 * DROP TABLE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropTable extends DropTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;
  /**
   * Names of constraints on this table that are dropped explicitly by a
   * separate `AlterTableDropConstraint` change. Those constraints must not be
   * claimed by `DropTable.drops` / `.requires`, otherwise catalog edges tied
   * to the constraint stableId will attach to this DropTable node instead of
   * the dedicated AlterTableDropConstraint node. When two tables with mutual
   * FK references are dropped in the same phase, that misattribution
   * produces an unbreakable cycle between the two DropTable changes.
   */
  public readonly externallyDroppedConstraints: ReadonlySet<string>;

  constructor(props: {
    table: Table;
    externallyDroppedConstraints?: ReadonlySet<string>;
  }) {
    super();
    this.table = props.table;
    this.externallyDroppedConstraints =
      props.externallyDroppedConstraints ?? new Set();
  }

  private get claimedConstraints() {
    return this.table.constraints.filter(
      (constraint) => !this.externallyDroppedConstraints.has(constraint.name),
    );
  }

  get drops() {
    return [
      this.table.stableId,
      ...this.table.columns.map((column) =>
        stableId.column(this.table.schema, this.table.name, column.name),
      ),
      // Include constraint stableIds so FK relationships that only exist at the
      // constraint level still affect whole-table drop ordering. Skip any
      // constraint that the diff layer is dropping via a dedicated
      // AlterTableDropConstraint change — that node owns the stableId.
      ...this.claimedConstraints.map((constraint) =>
        stableId.constraint(
          this.table.schema,
          this.table.name,
          constraint.name,
        ),
      ),
    ];
  }

  get requires() {
    return [
      this.table.stableId,
      ...this.table.columns.map((col) =>
        stableId.column(this.table.schema, this.table.name, col.name),
      ),
      // Mirror the dropped constraint ids in requires so drop-phase graph
      // consumers can connect catalog FK edges back to this table drop.
      ...this.claimedConstraints.map((constraint) =>
        stableId.constraint(
          this.table.schema,
          this.table.name,
          constraint.name,
        ),
      ),
    ];
  }

  serialize(_options?: SerializeOptions): string {
    return ["DROP TABLE", `${this.table.schema}.${this.table.name}`].join(" ");
  }
}
