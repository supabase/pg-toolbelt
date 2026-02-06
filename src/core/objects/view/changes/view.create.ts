import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { View } from "../view.model.ts";
import { CreateViewChange } from "./view.base.ts";

/**
 * Create a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-createview.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ TEMP | TEMPORARY ] [ RECURSIVE ] VIEW name [ ( column_name [, ...] ) ]
 *     [ WITH ( view_option_name [= view_option_value] [, ... ] ) ]
 *     AS query
 *     [ WITH [ CASCADE | LOCAL ] CHECK OPTION ]
 * ```
 */
export class CreateView extends CreateViewChange {
  public readonly view: View;
  public readonly orReplace?: boolean;
  public readonly scope = "object" as const;

  constructor(props: { view: View; orReplace?: boolean }) {
    super();
    this.view = props.view;
    this.orReplace = props.orReplace;
  }

  get creates() {
    return [
      this.view.stableId,
      ...this.view.columns.map((column) =>
        stableId.column(this.view.schema, this.view.name, column.name),
      ),
    ];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.view.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.view.owner));

    // Note: View definition dependencies (tables, types, procedures referenced in the query)
    // are handled via pg_depend for existing objects. For new objects, parsing the SQL
    // definition would be complex and error-prone, so we rely on pg_depend extraction
    // for those dependencies.

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [];
    const headTokens = [ctx.keyword("CREATE")];

    if (this.orReplace) {
      headTokens.push(ctx.keyword("OR"), ctx.keyword("REPLACE"));
    }

    headTokens.push(ctx.keyword("VIEW"), `${this.view.schema}.${this.view.name}`);
    lines.push(headTokens.join(" "));

    if (this.view.options && this.view.options.length > 0) {
      lines.push(
        ctx.line(ctx.keyword("WITH"), `(${this.view.options.join(", ")})`),
      );
    }

    const definition = this.view.definition;
    if (ctx.pretty) {
      lines.push(ctx.keyword("AS"));
      lines.push(definition);
    } else {
      lines.push(ctx.line(ctx.keyword("AS"), definition));
    }

    return ctx.joinLines(lines);
  }
}
