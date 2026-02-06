import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Publication } from "../publication.model.ts";
import {
  formatPublicationObjects,
  getPublicationOperations,
  isDefaultPublicationOperations,
} from "../utils.ts";
import { CreatePublicationChange } from "./publication.base.ts";

/**
 * Create a logical replication publication.
 *
 * @see https://www.postgresql.org/docs/17/sql-createpublication.html
 */
export class CreatePublication extends CreatePublicationChange {
  public readonly publication: Publication;
  public readonly scope = "object" as const;

  constructor(props: { publication: Publication }) {
    super();
    this.publication = props.publication;
  }

  get creates() {
    return [this.publication.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    dependencies.add(stableId.role(this.publication.owner));

    if (!this.publication.all_tables) {
      for (const table of this.publication.tables) {
        dependencies.add(stableId.table(table.schema, table.name));
        if (table.columns) {
          for (const column of table.columns) {
            dependencies.add(stableId.column(table.schema, table.name, column));
          }
        }
      }

      for (const schema of this.publication.schemas) {
        dependencies.add(stableId.schema(schema));
      }
    }

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(ctx.keyword("CREATE"), ctx.keyword("PUBLICATION"), this.publication.name),
    ];

    if (this.publication.all_tables) {
      lines.push(
        ctx.line(ctx.keyword("FOR"), ctx.keyword("ALL"), ctx.keyword("TABLES")),
      );
    } else {
      const objectClauses: string[] = [];
      for (const table of this.publication.tables) {
        let clause = `${ctx.keyword("TABLE")} ${table.schema}.${table.name}`;
        if (table.columns && table.columns.length > 0) {
          clause += ` (${table.columns.join(", ")})`;
        }
        if (table.row_filter) {
          const trimmed = table.row_filter.trim();
          const wrapped =
            trimmed.startsWith("(") && trimmed.endsWith(")")
              ? trimmed
              : `(${trimmed})`;
          clause += ` ${ctx.keyword("WHERE")} ${wrapped}`;
        }
        objectClauses.push(clause);
      }
      for (const schema of this.publication.schemas) {
        objectClauses.push(
          ctx.line(
            ctx.keyword("TABLES"),
            ctx.keyword("IN"),
            ctx.keyword("SCHEMA"),
            schema,
          ),
        );
      }

      if (objectClauses.length > 0) {
        const list = ctx.list(objectClauses, 1);
        lines.push(ctx.line(ctx.keyword("FOR"), list));
      }
    }

    const publicationOptions: string[] = [];
    if (!isDefaultPublicationOperations(this.publication)) {
      const operations = getPublicationOperations(this.publication);
      publicationOptions.push(`publish = '${operations.join(", ")}'`);
    }

    if (this.publication.publish_via_partition_root) {
      publicationOptions.push("publish_via_partition_root = true");
    }

    if (publicationOptions.length > 0) {
      const list = ctx.list(publicationOptions, 1);
      lines.push(
        ctx.line(
          ctx.keyword("WITH"),
          ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty),
        ),
      );
    }

    return ctx.joinLines(lines);
  }
}
