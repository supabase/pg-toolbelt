import { SqlFormatter } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { isUserDefinedTypeSchema, stableId } from "../../../utils.ts";
import type { CompositeType } from "../composite-type.model.ts";
import { CreateCompositeTypeChange } from "./composite-type.base.ts";

/**
 * Create a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS
 *     ( [ attribute_name data_type [ COLLATE collation ] [, ... ] ] )
 * ```
 */
export class CreateCompositeType extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "object" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get creates() {
    return [this.compositeType.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.compositeType.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.compositeType.owner));

    // Column type dependencies (user-defined types only)
    for (const col of this.compositeType.columns) {
      if (
        col.is_custom_type &&
        col.custom_type_schema &&
        col.custom_type_name
      ) {
        dependencies.add(
          stableId.type(col.custom_type_schema, col.custom_type_name),
        );
      }

      // Collation dependency (if non-default)
      if (col.collation) {
        const unquotedCollation = col.collation.replace(/^"|"$/g, "");
        const collationParts = unquotedCollation.split(".");
        if (collationParts.length === 2) {
          const [collationSchema, collationName] = collationParts;
          if (isUserDefinedTypeSchema(collationSchema)) {
            dependencies.add(
              stableId.collation(collationSchema, collationName),
            );
          }
        }
      }
    }

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = ["CREATE TYPE"];

    // Add schema and name
    parts.push(`${this.compositeType.schema}.${this.compositeType.name}`);

    // Add AS keyword
    parts.push("AS");

    parts.push(
      `(${this.compositeType.columns
        .map((column) => {
          const tokens: string[] = [];
          // attribute name and data type
          tokens.push(column.name);
          tokens.push(column.data_type_str);
          // Collation (only when non-default, already filtered by extractor)
          if (column.collation) {
            tokens.push("COLLATE", column.collation);
          }
          return tokens.join(" ");
        })
        .join(", ")})`,
    );

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const head = [
      formatter.keyword("CREATE"),
      formatter.keyword("TYPE"),
      `${this.compositeType.schema}.${this.compositeType.name}`,
      formatter.keyword("AS"),
    ].join(" ");

    const attributes = this.compositeType.columns.map((column) => {
      const tokens: string[] = [column.name, column.data_type_str];
      if (column.collation) {
        tokens.push(formatter.keyword("COLLATE"), column.collation);
      }
      return tokens.join(" ");
    });

    if (attributes.length === 0) {
      return `${head} ()`;
    }

    const list = formatter.list(attributes, 1);
    const body = formatter.parens(
      `${formatter.indent(1)}${list}`,
      true,
    );

    return `${head} ${body}`;
  }
}
