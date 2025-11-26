import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { AlterForeignDataWrapperChange } from "./foreign-data-wrapper.base.ts";

/**
 * Alter a foreign data wrapper.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterforeigndatawrapper.html
 *
 * Synopsis
 * ```sql
 * ALTER FOREIGN DATA WRAPPER name
 *     [ OPTIONS ( [ ADD | SET | DROP ] option ['value'] [, ... ] ) ]
 * ALTER FOREIGN DATA WRAPPER name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ```
 */

export type AlterForeignDataWrapper =
  | AlterForeignDataWrapperChangeOwner
  | AlterForeignDataWrapperSetOptions;

/**
 * ALTER FOREIGN DATA WRAPPER ... OWNER TO ...
 */
export class AlterForeignDataWrapperChangeOwner extends AlterForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: {
    foreignDataWrapper: ForeignDataWrapper;
    owner: string;
  }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
    this.owner = props.owner;
  }

  get requires() {
    return [this.foreignDataWrapper.stableId, stableId.role(this.owner)];
  }

  serialize(): string {
    return [
      "ALTER FOREIGN DATA WRAPPER",
      this.foreignDataWrapper.name,
      "OWNER TO",
      this.owner,
    ].join(" ");
  }
}

/**
 * ALTER FOREIGN DATA WRAPPER ... OPTIONS ( ADD | SET | DROP ... )
 */
export class AlterForeignDataWrapperSetOptions extends AlterForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>;
  public readonly scope = "object" as const;

  constructor(props: {
    foreignDataWrapper: ForeignDataWrapper;
    options: Array<{
      action: "ADD" | "SET" | "DROP";
      option: string;
      value?: string;
    }>;
  }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
    this.options = props.options;
  }

  get requires() {
    return [this.foreignDataWrapper.stableId];
  }

  serialize(): string {
    const optionParts: string[] = [];
    for (const opt of this.options) {
      if (opt.action === "DROP") {
        optionParts.push(`DROP ${opt.option}`);
      } else {
        const value = opt.value !== undefined ? quoteLiteral(opt.value) : "''";
        optionParts.push(`${opt.action} ${opt.option} ${value}`);
      }
    }

    return [
      "ALTER FOREIGN DATA WRAPPER",
      this.foreignDataWrapper.name,
      "OPTIONS",
      `(${optionParts.join(", ")})`,
    ].join(" ");
  }
}
