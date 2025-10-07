import { BaseChange, quoteLiteral } from "../../base.change.ts";
import type { Extension } from "../extension.model.ts";

/**
 * Alter an extension.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterextension.html
 *
 * Synopsis
 * ```sql
 * ALTER EXTENSION name UPDATE [ TO new_version ]
 * ALTER EXTENSION name SET SCHEMA new_schema
 * ALTER EXTENSION name ADD member_object
 * ALTER EXTENSION name DROP member_object
 * ```
 */

export type AlterExtension =
  | AlterExtensionSetSchema
  | AlterExtensionUpdateVersion;

/**
 * ALTER EXTENSION ... UPDATE TO ...
 */
export class AlterExtensionUpdateVersion extends BaseChange {
  public readonly extension: Extension;
  public readonly version: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "extension" as const;

  constructor(props: { extension: Extension; version: string }) {
    super();
    this.extension = props.extension;
    this.version = props.version;
  }

  get dependencies() {
    return [this.extension.stableId];
  }

  serialize(): string {
    return [
      "ALTER EXTENSION",
      this.extension.name,
      "UPDATE TO",
      quoteLiteral(this.version),
    ].join(" ");
  }
}

/**
 * ALTER EXTENSION ... SET SCHEMA ...
 */
export class AlterExtensionSetSchema extends BaseChange {
  public readonly extension: Extension;
  public readonly schema: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "extension" as const;

  constructor(props: { extension: Extension; schema: string }) {
    super();
    this.extension = props.extension;
    this.schema = props.schema;
  }

  get dependencies() {
    return [this.extension.stableId];
  }

  serialize(): string {
    return [
      "ALTER EXTENSION",
      this.extension.name,
      "SET SCHEMA",
      this.schema,
    ].join(" ");
  }
}
