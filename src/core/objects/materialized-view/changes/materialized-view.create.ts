import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { MaterializedView } from "../materialized-view.model.ts";
import { CreateMaterializedViewChange } from "./materialized-view.base.ts";

/**
 * Create a materialized view.
 *
 * @see https://www.postgresql.org/docs/17/sql-creatematerializedview.html
 *
 * Synopsis
 * ```sql
 * CREATE MATERIALIZED VIEW [ IF NOT EXISTS ] table_name
 *     [ (column_name [, ...] ) ]
 *     [ WITH ( storage_parameter [= value] [, ... ] ) ]
 *     [ TABLESPACE tablespace_name ]
 *     AS query
 *     [ WITH [ NO ] DATA ]
 * ```
 *
 * Notes for diff-based generation:
 * - IF NOT EXISTS is omitted: diffs are deterministic and explicit.
 * - (column_name, ...) list is derived from the SELECT query; we don't emit it.
 * - TABLESPACE is not currently modeled/extracted and is not emitted.
 * - WITH (options) is emitted only when non-empty.
 * - WITH NO DATA is always emitted when is_populated is false to ensure correct state.
 * - WITH DATA is emitted when is_populated is true.
 */
export class CreateMaterializedView extends CreateMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly scope = "object" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get creates() {
    return [
      this.materializedView.stableId,
      ...this.materializedView.columns.map((column) =>
        stableId.column(
          this.materializedView.schema,
          this.materializedView.name,
          column.name,
        ),
      ),
    ];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.materializedView.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.materializedView.owner));

    // Note: Materialized view definition dependencies are handled via pg_depend
    // for existing objects. For new objects, parsing the SQL definition would be complex.

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(
        ctx.keyword("CREATE"),
        ctx.keyword("MATERIALIZED"),
        ctx.keyword("VIEW"),
        `${this.materializedView.schema}.${this.materializedView.name}`,
      ),
    ];

    if (
      this.materializedView.options &&
      this.materializedView.options.length > 0
    ) {
      lines.push(
        ctx.line(
          ctx.keyword("WITH"),
          `(${this.materializedView.options.join(", ")})`,
        ),
      );
    }

    const definition = this.materializedView.definition;
    if (ctx.pretty) {
      lines.push(ctx.keyword("AS"));
      lines.push(definition);
    } else {
      lines.push(ctx.line(ctx.keyword("AS"), definition));
    }

    if (this.materializedView.is_populated) {
      lines.push(ctx.line(ctx.keyword("WITH"), ctx.keyword("DATA")));
    } else {
      lines.push(
        ctx.line(
          ctx.keyword("WITH"),
          ctx.keyword("NO"),
          ctx.keyword("DATA"),
        ),
      );
    }

    return ctx.joinLines(lines);
  }
}
