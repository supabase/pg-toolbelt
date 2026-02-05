import { SqlFormatter } from "../../../format/index.ts";
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
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = ["CREATE SEQUENCE"];

    // Add schema and name
    parts.push(`${this.sequence.schema}.${this.sequence.name}`);

    // Add data type if not default
    if (this.sequence.data_type && this.sequence.data_type !== "bigint") {
      parts.push("AS", this.sequence.data_type);
    }

    // Add INCREMENT
    if (this.sequence.increment !== 1) {
      parts.push("INCREMENT BY", this.sequence.increment.toString());
    }

    // Add MINVALUE if not default (1)
    if (this.sequence.minimum_value !== BigInt(1)) {
      parts.push("MINVALUE", this.sequence.minimum_value.toString());
    }

    // Add MAXVALUE if not default (depends on data type)
    const defaultMaxValue =
      this.sequence.data_type === "integer"
        ? BigInt("2147483647")
        : BigInt("9223372036854775807");
    if (this.sequence.maximum_value !== defaultMaxValue) {
      parts.push("MAXVALUE", this.sequence.maximum_value.toString());
    }

    // Add START
    if (this.sequence.start_value !== 1) {
      parts.push("START WITH", this.sequence.start_value.toString());
    }

    // Add CACHE
    if (this.sequence.cache_size !== 1) {
      parts.push("CACHE", this.sequence.cache_size.toString());
    }

    // Add CYCLE only if true (default is NO CYCLE)
    if (this.sequence.cycle_option) {
      parts.push("CYCLE");
    }

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const lines: string[] = [
      `${formatter.keyword("CREATE")} ${formatter.keyword("SEQUENCE")} ${this.sequence.schema}.${this.sequence.name}`,
    ];

    if (this.sequence.data_type && this.sequence.data_type !== "bigint") {
      lines.push(
        `${formatter.keyword("AS")} ${this.sequence.data_type}`,
      );
    }

    if (this.sequence.increment !== 1) {
      lines.push(
        `${formatter.keyword("INCREMENT")} ${formatter.keyword("BY")} ${this.sequence.increment}`,
      );
    }

    if (this.sequence.minimum_value !== BigInt(1)) {
      lines.push(
        `${formatter.keyword("MINVALUE")} ${this.sequence.minimum_value}`,
      );
    }

    const defaultMaxValue =
      this.sequence.data_type === "integer"
        ? BigInt("2147483647")
        : BigInt("9223372036854775807");
    if (this.sequence.maximum_value !== defaultMaxValue) {
      lines.push(
        `${formatter.keyword("MAXVALUE")} ${this.sequence.maximum_value}`,
      );
    }

    if (this.sequence.start_value !== 1) {
      lines.push(
        `${formatter.keyword("START")} ${formatter.keyword("WITH")} ${this.sequence.start_value}`,
      );
    }

    if (this.sequence.cache_size !== 1) {
      lines.push(
        `${formatter.keyword("CACHE")} ${this.sequence.cache_size}`,
      );
    }

    if (this.sequence.cycle_option) {
      lines.push(formatter.keyword("CYCLE"));
    }

    return lines.join("\n");
  }
}
