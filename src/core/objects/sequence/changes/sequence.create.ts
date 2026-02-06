import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Sequence } from "../sequence.model.ts";
import { CreateSequenceChange } from "./sequence.base.ts";

/**
 * Create a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-createsequence.html
 *
 * Synopsis
 * ```sql
 * CREATE [ TEMPORARY | TEMP ] SEQUENCE [ IF NOT EXISTS ] name [ INCREMENT [ BY ] increment ]
 *     [ MINVALUE minvalue | NO MINVALUE ] [ MAXVALUE maxvalue | NO MAXVALUE ]
 *     [ START [ WITH ] start ] [ CACHE cache ] [ [ NO ] CYCLE ]
 *     [ OWNED BY { table_name.column_name | NONE } ]
 * ```
 */
export class CreateSequence extends CreateSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "object" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get creates() {
    return [this.sequence.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.sequence.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.sequence.owner));

    // Owned by table/column dependency (if set)
    if (
      this.sequence.owned_by_schema &&
      this.sequence.owned_by_table &&
      this.sequence.owned_by_column
    ) {
      dependencies.add(
        stableId.table(
          this.sequence.owned_by_schema,
          this.sequence.owned_by_table,
        ),
      );
      dependencies.add(
        stableId.column(
          this.sequence.owned_by_schema,
          this.sequence.owned_by_table,
          this.sequence.owned_by_column,
        ),
      );
    }

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(
        ctx.keyword("CREATE"),
        ctx.keyword("SEQUENCE"),
        `${this.sequence.schema}.${this.sequence.name}`,
      ),
    ];

    if (this.sequence.data_type && this.sequence.data_type !== "bigint") {
      lines.push(ctx.line(ctx.keyword("AS"), this.sequence.data_type));
    }

    if (this.sequence.increment !== 1) {
      lines.push(
        ctx.line(
          ctx.keyword("INCREMENT"),
          ctx.keyword("BY"),
          this.sequence.increment.toString(),
        ),
      );
    }

    if (this.sequence.minimum_value !== BigInt(1)) {
      lines.push(
        ctx.line(
          ctx.keyword("MINVALUE"),
          this.sequence.minimum_value.toString(),
        ),
      );
    }

    const defaultMaxValue =
      this.sequence.data_type === "integer"
        ? BigInt("2147483647")
        : BigInt("9223372036854775807");
    if (this.sequence.maximum_value !== defaultMaxValue) {
      lines.push(
        ctx.line(
          ctx.keyword("MAXVALUE"),
          this.sequence.maximum_value.toString(),
        ),
      );
    }

    if (this.sequence.start_value !== 1) {
      lines.push(
        ctx.line(
          ctx.keyword("START"),
          ctx.keyword("WITH"),
          this.sequence.start_value.toString(),
        ),
      );
    }

    if (this.sequence.cache_size !== 1) {
      lines.push(
        ctx.line(
          ctx.keyword("CACHE"),
          this.sequence.cache_size.toString(),
        ),
      );
    }

    if (this.sequence.cycle_option) {
      lines.push(ctx.keyword("CYCLE"));
    }

    return ctx.joinLines(lines);
  }
}
