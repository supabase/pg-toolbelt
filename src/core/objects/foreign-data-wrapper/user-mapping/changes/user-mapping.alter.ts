import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import type { UserMapping } from "../user-mapping.model.ts";
import { AlterUserMappingChange } from "./user-mapping.base.ts";

/**
 * Alter a user mapping.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterusermapping.html
 *
 * Synopsis
 * ```sql
 * ALTER USER MAPPING FOR { user_name | USER | CURRENT_ROLE | CURRENT_USER | PUBLIC | SESSION_USER }
 *     SERVER server_name
 *     OPTIONS ( [ ADD | SET | DROP ] option ['value'] [, ... ] )
 * ```
 */

export type AlterUserMapping = AlterUserMappingSetOptions;

/**
 * ALTER USER MAPPING ... OPTIONS ( ADD | SET | DROP ... )
 */
export class AlterUserMappingSetOptions extends AlterUserMappingChange {
  public readonly userMapping: UserMapping;
  public readonly options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>;
  public readonly scope = "object" as const;

  constructor(props: {
    userMapping: UserMapping;
    options: Array<{
      action: "ADD" | "SET" | "DROP";
      option: string;
      value?: string;
    }>;
  }) {
    super();
    this.userMapping = props.userMapping;
    this.options = props.options;
  }

  get requires() {
    return [this.userMapping.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const optionParts: string[] = [];
    for (const opt of this.options) {
      if (opt.action === "DROP") {
        optionParts.push(`${ctx.keyword("DROP")} ${opt.option}`);
      } else {
        const value = opt.value !== undefined ? quoteLiteral(opt.value) : "''";
        optionParts.push(`${ctx.keyword(opt.action)} ${opt.option} ${value}`);
      }
    }

    return ctx.line(
      ctx.keyword("ALTER USER MAPPING FOR"),
      this.userMapping.user,
      ctx.keyword("SERVER"),
      this.userMapping.server,
      ctx.keyword("OPTIONS"),
      `(${optionParts.join(", ")})`,
    );
  }
}
