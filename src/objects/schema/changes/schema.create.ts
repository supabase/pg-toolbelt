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

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get dependencies() {
    return [this.schema.stableId];
  }

  serialize(): string {
    const parts: string[] = ["CREATE SCHEMA"];

    // Add schema name
    parts.push(this.schema.name);

    // Add AUTHORIZATION
    parts.push("AUTHORIZATION", this.schema.owner);

    return parts.join(" ");
  }
}
