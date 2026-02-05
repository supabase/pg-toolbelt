import { SqlFormatter } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Schema } from "../schema.model.ts";
import { CreateSchemaChange } from "./schema.base.ts";

/**
 * Create a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-createschema.html
 *
 * Synopsis
 * ```sql
 * CREATE SCHEMA [ IF NOT EXISTS ] schema_name [ AUTHORIZATION role_specification ] [ schema_element [ ... ] ]
 * CREATE SCHEMA [ IF NOT EXISTS ] AUTHORIZATION role_specification [ schema_element [ ... ] ]
 * CREATE SCHEMA [ IF NOT EXISTS ] schema_name AUTHORIZATION role_specification [ schema_element [ ... ] ]
 * ```
 */
export class CreateSchema extends CreateSchemaChange {
  public readonly schema: Schema;
  public readonly scope = "object" as const;

  constructor(props: { schema: Schema; skipAuthorization?: boolean }) {
    super();
    this.schema = props.schema;
  }

  get creates() {
    return [this.schema.stableId];
  }

  get requires() {
    return [stableId.role(this.schema.owner)];
  }

  serialize(options?: SerializeOptions): string {
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter, options);
    }

    const parts: string[] = ["CREATE SCHEMA"];

    // Add schema name
    parts.push(this.schema.name);

    // Add AUTHORIZATION
    if (!options?.skipAuthorization) {
      parts.push("AUTHORIZATION", this.schema.owner);
    }

    return parts.join(" ");
  }

  private serializeFormatted(
    formatter: SqlFormatter,
    options?: SerializeOptions,
  ): string {
    const lines: string[] = [
      `${formatter.keyword("CREATE")} ${formatter.keyword("SCHEMA")} ${this.schema.name}`,
    ];

    if (!options?.skipAuthorization) {
      lines.push(
        `${formatter.keyword("AUTHORIZATION")} ${this.schema.owner}`,
      );
    }

    return lines.join("\n");
  }
}
