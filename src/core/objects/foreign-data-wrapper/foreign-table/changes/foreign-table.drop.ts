import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import { DropForeignTableChange } from "./foreign-table.base.ts";

/**
 * Drop a foreign table.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropforeigntable.html
 *
 * Synopsis
 * ```sql
 * DROP FOREIGN TABLE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropForeignTable extends DropForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get drops() {
    return [this.foreignTable.stableId];
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("DROP FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
    );
  }
}
