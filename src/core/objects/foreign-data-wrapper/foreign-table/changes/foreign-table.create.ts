import { SqlFormatter } from "../../../../format/index.ts";
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
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = ["CREATE FOREIGN TABLE"];

    // Add schema and name
    parts.push(`${this.foreignTable.schema}.${this.foreignTable.name}`);

    // Add columns
    const columnDefs: string[] = [];
    for (const col of this.foreignTable.columns) {
      const colParts: string[] = [col.name, col.data_type_str];
      columnDefs.push(colParts.join(" "));
    }
    parts.push(`(${columnDefs.join(", ")})`);

    // Add SERVER clause
    parts.push("SERVER", this.foreignTable.server);

    // Add OPTIONS clause (table-level)
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
        parts.push(`OPTIONS (${optionPairs.join(", ")})`);
      }
    }

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const head = `${formatter.keyword("CREATE")} ${formatter.keyword(
      "FOREIGN",
    )} ${formatter.keyword("TABLE")} ${this.foreignTable.schema}.${this.foreignTable.name}`;

    let columns = "()";
    if (this.foreignTable.columns.length > 0) {
      const rows = this.foreignTable.columns.map((col) => [
        col.name,
        col.data_type_str,
      ]);
      const aligned = formatter.alignColumns(rows);
      const list = formatter.list(aligned, 1);
      columns = formatter.parens(`${formatter.indent(1)}${list}`, true);
    }

    const lines: string[] = [`${head} ${columns}`];
    lines.push(
      `${formatter.keyword("SERVER")} ${this.foreignTable.server}`,
    );

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
        const optionList = formatter.list(optionPairs, 1);
        lines.push(
          `${formatter.keyword("OPTIONS")} ${formatter.parens(
            `${formatter.indent(1)}${optionList}`,
            true,
          )}`,
        );
      }
    }

    return lines.join("\n");
  }
}
