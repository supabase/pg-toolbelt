import { createFormatContext } from "../../../format/index.ts";
import type { FormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { isUserDefinedTypeSchema, stableId } from "../../utils.ts";
import type { Table } from "../table.model.ts";
import { CreateTableChange } from "./table.base.ts";

/**
 * Create a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtable.html
 *
 * Synopsis
 * ```sql
 * CREATE [ [ GLOBAL | LOCAL ] { TEMPORARY | TEMP } | UNLOGGED ] TABLE [ IF NOT EXISTS ] table_name ( [
 *   { column_name data_type [ COLLATE collation ] [ column_constraint [ ... ] ]
 *     | table_constraint
 *     | LIKE source_table [ like_option ... ] }
 *     [, ... ]
 * ] )
 * [ INHERITS ( parent_table [, ... ] ) ]
 * [ PARTITION BY { RANGE | LIST | HASH } ( { column_name | ( expression ) } [, ... ] ) ]
 * [ USING method ]
 * [ WITH ( storage_parameter [= value] [, ... ] ) | WITHOUT OIDS ]
 * [ ON COMMIT { PRESERVE ROWS | DELETE ROWS | DROP } ]
 * [ TABLESPACE tablespace_name ]
 * ```
 */
export class CreateTable extends CreateTableChange {
  public readonly table: Table;
  public readonly scope = "object" as const;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get creates() {
    return [
      this.table.stableId,
      ...this.table.columns.map((col) =>
        stableId.column(this.table.schema, this.table.name, col.name),
      ),
    ];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.table.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.table.owner));

    // Parent table dependency (for inheritance or partitioning)
    if (this.table.parent_schema && this.table.parent_name) {
      dependencies.add(
        stableId.table(this.table.parent_schema, this.table.parent_name),
      );
    }

    // Column type dependencies (user-defined types only)
    for (const col of this.table.columns) {
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
        // Collations are stored as schema-qualified strings like "public.collation_name"
        // Note: The collation string may be quoted, so we need to handle that
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
    const parts: string[] = [ctx.keyword("CREATE")];

    if (this.table.persistence === "t") {
      parts.push(ctx.keyword("TEMPORARY"));
    } else if (this.table.persistence === "u") {
      parts.push(ctx.keyword("UNLOGGED"));
    }

    parts.push(ctx.keyword("TABLE"));
    parts.push(`${this.table.schema}.${this.table.name}`);

    const head = parts.join(" ");

    if (
      this.table.parent_schema &&
      this.table.parent_name &&
      this.table.partition_bound
    ) {
      const lines = [
        head,
        ctx.line(
          ctx.keyword("PARTITION"),
          ctx.keyword("OF"),
          `${this.table.parent_schema}.${this.table.parent_name}`,
        ),
        this.table.partition_bound,
      ];
      return ctx.joinLines(lines);
    }

    const lines: string[] = [];
    lines.push(ctx.line(head, this.formatColumns(ctx)));

    if (
      this.table.parent_schema &&
      this.table.parent_name &&
      !this.table.partition_bound
    ) {
      lines.push(
        ctx.line(
          ctx.keyword("INHERITS"),
          `(${this.table.parent_schema}.${this.table.parent_name})`,
        ),
      );
    }

    if (this.table.partition_by) {
      lines.push(
        ctx.line(
          ctx.keyword("PARTITION"),
          ctx.keyword("BY"),
          this.table.partition_by,
        ),
      );
    }

    if (this.table.options && this.table.options.length > 0) {
      lines.push(
        ctx.line(ctx.keyword("WITH"), `(${this.table.options.join(", ")})`),
      );
    }

    return ctx.joinLines(lines);
  }

  private formatColumns(ctx: FormatContext): string {
    if (this.table.columns.length === 0) {
      return "()";
    }

    const rows = this.table.columns.map((col) => {
      const typeTokens: string[] = [col.data_type_str];
      if (col.collation) {
        typeTokens.push(ctx.keyword("COLLATE"), col.collation);
      }
      const typeString = typeTokens.join(" ");

      const constraintTokens: string[] = [];

      if (col.is_identity) {
        if (col.is_identity_always) {
          constraintTokens.push(
            ctx.keyword("GENERATED"),
            ctx.keyword("ALWAYS"),
            ctx.keyword("AS"),
            ctx.keyword("IDENTITY"),
          );
        } else {
          constraintTokens.push(
            ctx.keyword("GENERATED"),
            ctx.keyword("BY"),
            ctx.keyword("DEFAULT"),
            ctx.keyword("AS"),
            ctx.keyword("IDENTITY"),
          );
        }
      } else if (col.is_generated && col.default) {
        constraintTokens.push(
          ctx.keyword("GENERATED"),
          ctx.keyword("ALWAYS"),
          ctx.keyword("AS"),
          `(${col.default})`,
          ctx.keyword("STORED"),
        );
      } else if (col.default) {
        constraintTokens.push(ctx.keyword("DEFAULT"), col.default);
      }

      if (col.not_null) {
        constraintTokens.push(
          ctx.keyword("NOT"),
          ctx.keyword("NULL"),
        );
      }

      if (constraintTokens.length > 0) {
        return [col.name, typeString, constraintTokens.join(" ")];
      }

      return [col.name, typeString];
    });

    const aligned = ctx.alignColumns(rows);
    const list = ctx.list(aligned, 1);
    return ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty);
  }
}
