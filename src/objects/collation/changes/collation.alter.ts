import { BaseChange } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

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
export class AlterCollationChangeOwner extends BaseChange {
  public readonly collation: Collation;
  public readonly owner: string;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { collation: Collation; owner: string }) {
    super();
    this.collation = props.collation;
    this.owner = props.owner;
  }

  get dependencies() {
    return [this.collation.stableId];
  }

  serialize(): string {
    return [
      "ALTER COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * ALTER COLLATION ... REFRESH VERSION
 */
export class AlterCollationRefreshVersion extends BaseChange {
  public readonly collation: Collation;
  public readonly operation = "alter" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "collation" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [this.collation.stableId];
  }

  serialize(): string {
    return [
      "ALTER COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
      "REFRESH VERSION",
    ].join(" ");
  }
}

/**
 * Replace a collation by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER COLLATION change.
 */
// NOTE: ReplaceCollation has been removed. Non-alterable property changes
// are modeled as separate DropCollation + CreateCollation changes in collation.diff.ts.
