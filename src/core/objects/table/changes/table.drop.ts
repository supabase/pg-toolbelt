import { createFormatContext } from "../../../format/index.ts";
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

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get drops() {
    return [
      this.table.stableId,
      ...this.table.columns.map((column) =>
        stableId.column(this.table.schema, this.table.name, column.name),
      ),
    ];
  }

  get requires() {
    return [
      this.table.stableId,
      ...this.table.columns.map((col) =>
        stableId.column(this.table.schema, this.table.name, col.name),
      ),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("DROP TABLE"),
      `${this.table.schema}.${this.table.name}`,
    );
  }
}
