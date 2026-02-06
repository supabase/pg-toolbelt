import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import { CreateForeignTableChange } from "./foreign-table.base.ts";

/**
 * Create a foreign table.
 *
 * @see https://www.postgresql.org/docs/17/sql-createforeigntable.html
 *
 * Synopsis
 * ```sql
 * CREATE FOREIGN TABLE [ IF NOT EXISTS ] table_name
 *     ( [ { column_name data_type [ OPTIONS ( option 'value' [, ... ] ) ] [ COLLATE collation ] [ column_constraint [ ... ] ] | table_constraint } [, ... ] ] )
 *     SERVER server_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateForeignTable extends CreateForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get creates() {
    return [this.foreignTable.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.foreignTable.schema));

    // Server dependency
    dependencies.add(stableId.server(this.foreignTable.server));

    // Owner dependency
    dependencies.add(stableId.role(this.foreignTable.owner));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const head = ctx.line(
      ctx.keyword("CREATE"),
      ctx.keyword("FOREIGN"),
      ctx.keyword("TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
    );

    let columns = "()";
    if (this.foreignTable.columns.length > 0) {
      const rows = this.foreignTable.columns.map((col) => [
        col.name,
        col.data_type_str,
      ]);
      const aligned = ctx.alignColumns(rows);
      const list = ctx.list(aligned, 1);
      columns = ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty);
    }

    const lines: string[] = [ctx.line(head, columns)];
    lines.push(ctx.line(ctx.keyword("SERVER"), this.foreignTable.server));

    if (this.foreignTable.options && this.foreignTable.options.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.foreignTable.options.length; i += 2) {
        if (i + 1 < this.foreignTable.options.length) {
          optionPairs.push(
            `${this.foreignTable.options[i]} ${quoteLiteral(this.foreignTable.options[i + 1])}`,
          );
        }
      }
      if (optionPairs.length > 0) {
        const optionList = ctx.list(optionPairs, 1);
        lines.push(
          ctx.line(
            ctx.keyword("OPTIONS"),
            ctx.parens(`${ctx.indent(1)}${optionList}`, ctx.pretty),
          ),
        );
      }
    }

    return ctx.joinLines(lines);
  }
}
