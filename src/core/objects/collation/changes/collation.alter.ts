import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Collation } from "../collation.model.ts";
import { AlterCollationChange } from "./collation.base.ts";

/**
 * Alter a collation.
 *
 * @see https://www.postgresql.org/docs/17/sql-altercollation.html
 *
 * Synopsis
 * ```sql
 * ALTER COLLATION name REFRESH VERSION
 * ALTER COLLATION name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER COLLATION name RENAME TO new_name
 * ```
 */

export type AlterCollation =
  | AlterCollationChangeOwner
  | AlterCollationRefreshVersion;

/**
 * ALTER COLLATION ... OWNER TO ...
 */
export class AlterCollationChangeOwner extends AlterCollationChange {
  public readonly collation: Collation;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { collation: Collation; owner: string }) {
    super();
    this.collation = props.collation;
    this.owner = props.owner;
  }

  get requires() {
    return [this.collation.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER COLLATION"),
      `${this.collation.schema}.${this.collation.name}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}

/**
 * ALTER COLLATION ... REFRESH VERSION
 */
export class AlterCollationRefreshVersion extends AlterCollationChange {
  public readonly collation: Collation;
  public readonly scope = "object" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get requires() {
    return [this.collation.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER COLLATION"),
      `${this.collation.schema}.${this.collation.name}`,
      ctx.keyword("REFRESH VERSION"),
    );
  }
}

/**
 * Replace a collation by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER COLLATION change.
 */
// NOTE: ReplaceCollation has been removed. Non-alterable property changes
// are modeled as separate DropCollation + CreateCollation changes in collation.diff.ts.
