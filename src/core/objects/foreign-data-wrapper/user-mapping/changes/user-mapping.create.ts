import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { UserMapping } from "../user-mapping.model.ts";
import { CreateUserMappingChange } from "./user-mapping.base.ts";

/**
 * Create a user mapping.
 *
 * @see https://www.postgresql.org/docs/17/sql-createusermapping.html
 *
 * Synopsis
 * ```sql
 * CREATE USER MAPPING [ IF NOT EXISTS ] FOR { user_name | USER | CURRENT_ROLE | CURRENT_USER | PUBLIC | SESSION_USER }
 *     SERVER server_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateUserMapping extends CreateUserMappingChange {
  public readonly userMapping: UserMapping;
  public readonly scope = "object" as const;

  constructor(props: { userMapping: UserMapping }) {
    super();
    this.userMapping = props.userMapping;
  }

  get creates() {
    return [this.userMapping.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Server dependency
    dependencies.add(stableId.server(this.userMapping.server));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(
        ctx.keyword("CREATE"),
        ctx.keyword("USER"),
        ctx.keyword("MAPPING"),
        ctx.keyword("FOR"),
        this.userMapping.user,
      ),
      ctx.line(ctx.keyword("SERVER"), this.userMapping.server),
    ];

    if (this.userMapping.options && this.userMapping.options.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.userMapping.options.length; i += 2) {
        if (i + 1 < this.userMapping.options.length) {
          optionPairs.push(
            `${this.userMapping.options[i]} ${quoteLiteral(this.userMapping.options[i + 1])}`,
          );
        }
      }
      if (optionPairs.length > 0) {
        const list = ctx.list(optionPairs, 1);
        lines.push(
          ctx.line(
            ctx.keyword("OPTIONS"),
            ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty),
          ),
        );
      }
    }

    return ctx.joinLines(lines);
  }
}
