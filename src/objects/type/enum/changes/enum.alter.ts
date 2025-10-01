import { Change, quoteLiteral } from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";

/**
 * Alter an enum.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertype.html
 *
 * Synopsis
 * ```sql
 * ALTER TYPE name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER TYPE name RENAME TO new_name
 * ALTER TYPE name ADD VALUE [ IF NOT EXISTS ] new_enum_value [ { BEFORE | AFTER } neighbor_enum_value ]
 * ALTER TYPE name RENAME VALUE existing_enum_value TO new_enum_value
 * ```
 */

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterEnumChangeOwner extends Change {
  public readonly enum: Enum;
  public readonly owner: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "enum" as const;

  constructor(props: { enum: Enum; owner: string }) {
    super();
    this.enum = props.enum;
    this.owner = props.owner;
  }

  get dependencies() {
    return [this.enum.stableId];
  }

  serialize(): string {
    return [
      "ALTER TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * ALTER TYPE ... ADD VALUE ...
 */
export class AlterEnumAddValue extends Change {
  public readonly enum: Enum;
  public readonly newValue: string;
  public readonly position?: { before?: string; after?: string };
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "enum" as const;

  constructor(props: {
    enum: Enum;
    newValue: string;
    position?: { before?: string; after?: string };
  }) {
    super();
    this.enum = props.enum;
    this.newValue = props.newValue;
    this.position = props.position;
  }

  get dependencies() {
    return [this.enum.stableId];
  }

  serialize(): string {
    const parts = [
      "ALTER TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "ADD VALUE",
      quoteLiteral(this.newValue),
    ];

    if (this.position?.before) {
      parts.push("BEFORE", quoteLiteral(this.position.before));
    } else if (this.position?.after) {
      parts.push("AFTER", quoteLiteral(this.position.after));
    }

    return parts.join(" ");
  }
}

// NOTE: ReplaceEnum removed. Complex enum changes should be handled in diff with Drop + Create when needed.
