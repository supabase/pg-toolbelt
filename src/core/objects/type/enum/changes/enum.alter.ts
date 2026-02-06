import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import type { Enum } from "../enum.model.ts";
import { AlterEnumChange } from "./enum.base.ts";

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

export type AlterEnum = AlterEnumAddValue | AlterEnumChangeOwner;

/**
 * ALTER TYPE ... OWNER TO ...
 */
export class AlterEnumChangeOwner extends AlterEnumChange {
  public readonly enum: Enum;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { enum: Enum; owner: string }) {
    super();
    this.enum = props.enum;
    this.owner = props.owner;
  }

  get requires() {
    return [this.enum.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER TYPE"),
      `${this.enum.schema}.${this.enum.name}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}

/**
 * ALTER TYPE ... ADD VALUE ...
 */
export class AlterEnumAddValue extends AlterEnumChange {
  public readonly enum: Enum;
  public readonly newValue: string;
  public readonly position?: { before?: string; after?: string };
  public readonly scope = "object" as const;

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

  get requires() {
    return [this.enum.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const parts = [
      ctx.keyword("ALTER TYPE"),
      `${this.enum.schema}.${this.enum.name}`,
      ctx.keyword("ADD VALUE"),
      quoteLiteral(this.newValue),
    ];

    if (this.position?.before) {
      parts.push(ctx.keyword("BEFORE"), quoteLiteral(this.position.before));
    } else if (this.position?.after) {
      parts.push(ctx.keyword("AFTER"), quoteLiteral(this.position.after));
    }

    return ctx.line(...parts);
  }
}

// NOTE: ReplaceEnum removed. Complex enum changes should be handled in diff with Drop + Create when needed.
