import { BaseChange } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

/**
 * Alter a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterschema.html
 *
 * Synopsis
 * ```sql
 * ALTER SCHEMA name RENAME TO new_name
 * ALTER SCHEMA name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ```
 */

export type AlterSchema = AlterSchemaChangeOwner;

/**
 * ALTER SCHEMA ... OWNER TO ...
 */
export class AlterSchemaChangeOwner extends BaseChange {
  public readonly schema: Schema;
  public readonly owner: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "schema" as const;

  constructor(props: { schema: Schema; owner: string }) {
    super();
    this.schema = props.schema;
    this.owner = props.owner;
  }

  get dependencies() {
    return [this.schema.stableId];
  }

  serialize(): string {
    return ["ALTER SCHEMA", this.schema.name, "OWNER TO", this.owner].join(" ");
  }
}

/**
 * Replace a schema by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER SCHEMA change.
 */
// NOTE: ReplaceSchema removed. Non-alterable changes would be emitted via Drop + Create in schema.diff.ts if needed.
