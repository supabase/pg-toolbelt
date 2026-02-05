import { SqlFormatter } from "../../../format/index.ts";
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
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = ["CREATE PUBLICATION", this.publication.name];

    if (this.publication.all_tables) {
      parts.push("FOR ALL TABLES");
    } else {
      const objectClauses = formatPublicationObjects(
        this.publication.tables,
        this.publication.schemas,
      );
      if (objectClauses.length > 0) {
        parts.push("FOR", objectClauses.join(", "));
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
      parts.push("WITH", `(${publicationOptions.join(", ")})`);
    }

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const lines: string[] = [
      `${formatter.keyword("CREATE")} ${formatter.keyword("PUBLICATION")} ${this.publication.name}`,
    ];

    if (this.publication.all_tables) {
      lines.push(
        `${formatter.keyword("FOR")} ${formatter.keyword("ALL")} ${formatter.keyword("TABLES")}`,
      );
    } else {
      const objectClauses: string[] = [];
      for (const table of this.publication.tables) {
        let clause = `${formatter.keyword("TABLE")} ${table.schema}.${table.name}`;
        if (table.columns && table.columns.length > 0) {
          clause += ` (${table.columns.join(", ")})`;
        }
        if (table.row_filter) {
          const trimmed = table.row_filter.trim();
          const wrapped =
            trimmed.startsWith("(") && trimmed.endsWith(")")
              ? trimmed
              : `(${trimmed})`;
          clause += ` ${formatter.keyword("WHERE")} ${wrapped}`;
        }
        objectClauses.push(clause);
      }
      for (const schema of this.publication.schemas) {
        objectClauses.push(
          `${formatter.keyword("TABLES")} ${formatter.keyword("IN")} ${formatter.keyword("SCHEMA")} ${schema}`,
        );
      }

      if (objectClauses.length > 0) {
        const list = formatter.list(objectClauses, 1);
        lines.push(`${formatter.keyword("FOR")} ${list}`);
      }
    }

    const options: string[] = [];
    if (!isDefaultPublicationOperations(this.publication)) {
      const operations = getPublicationOperations(this.publication);
      options.push(`publish = '${operations.join(", ")}'`);
    }

    if (this.publication.publish_via_partition_root) {
      options.push("publish_via_partition_root = true");
    }

    if (options.length > 0) {
      const list = formatter.list(options, 1);
      lines.push(
        `${formatter.keyword("WITH")} ${formatter.parens(
          `${formatter.indent(1)}${list}`,
          true,
        )}`,
      );
    }

    return lines.join("\n");
  }
}
