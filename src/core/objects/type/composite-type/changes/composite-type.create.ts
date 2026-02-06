import { createFormatContext } from "../../../../format/index.ts";
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
    const ctx = createFormatContext(options?.format);

    const head = ctx.line(
      ctx.keyword("CREATE"),
      ctx.keyword("TYPE"),
      `${this.compositeType.schema}.${this.compositeType.name}`,
      ctx.keyword("AS"),
    );

    const attributeRows = this.compositeType.columns.map((column) => {
      const tokens: string[] = [column.name, column.data_type_str];
      if (column.collation) {
        tokens.push(ctx.keyword("COLLATE"), column.collation);
      }
      return tokens;
    });
    const attributes = ctx.alignColumns(attributeRows);

    const body =
      attributes.length === 0
        ? "()"
        : ctx.parens(
            `${ctx.indent(1)}${ctx.list(attributes, 1)}`,
            ctx.pretty,
          );

    return ctx.line(head, body);
  }
}
