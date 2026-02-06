import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicyChange } from "./rls-policy.base.ts";

/**
 * Create an RLS policy.
 *
 * @see https://www.postgresql.org/docs/17/sql-createpolicy.html
 *
 * Synopsis
 * ```sql
 * CREATE POLICY name ON table_name
 *     [ AS { PERMISSIVE | RESTRICTIVE } ]
 *     [ FOR { ALL | SELECT | INSERT | UPDATE | DELETE } ]
 *     [ TO { role_name | PUBLIC | CURRENT_ROLE | CURRENT_USER | SESSION_USER } [, ...] ]
 *     [ USING ( using_expression ) ]
 *     [ WITH CHECK ( with_check_expression ) ]
 * ```
 */
export class CreateRlsPolicy extends CreateRlsPolicyChange {
  public readonly policy: RlsPolicy;
  public readonly scope = "object" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get creates() {
    return [this.policy.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.policy.schema));

    // Table dependency
    dependencies.add(
      stableId.table(this.policy.schema, this.policy.table_name),
    );

    // Owner dependency
    dependencies.add(stableId.role(this.policy.owner));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [];
    const head = ctx.line(
      ctx.keyword("CREATE"),
      ctx.keyword("POLICY"),
      this.policy.name,
      ctx.keyword("ON"),
      `${this.policy.schema}.${this.policy.table_name}`,
    );
    lines.push(head);

    if (!this.policy.permissive) {
      lines.push(ctx.line(ctx.keyword("AS"), ctx.keyword("RESTRICTIVE")));
    }

    const commandMap: Record<string, string> = {
      r: ctx.keyword("SELECT"),
      a: ctx.keyword("INSERT"),
      w: ctx.keyword("UPDATE"),
      d: ctx.keyword("DELETE"),
      "*": ctx.keyword("ALL"),
    };
    if (this.policy.command && this.policy.command !== "*") {
      lines.push(
        ctx.line(ctx.keyword("FOR"), commandMap[this.policy.command]),
      );
    }

    if (this.policy.roles && this.policy.roles.length > 0) {
      const onlyPublic =
        this.policy.roles.length === 1 &&
        this.policy.roles[0].toLowerCase() === "public";
      if (!onlyPublic) {
        lines.push(ctx.line(ctx.keyword("TO"), this.policy.roles.join(", ")));
      }
    }

    if (this.policy.using_expression) {
      lines.push(
        ctx.line(ctx.keyword("USING"), `(${this.policy.using_expression})`),
      );
    }

    if (this.policy.with_check_expression) {
      lines.push(
        ctx.line(
          ctx.keyword("WITH"),
          ctx.keyword("CHECK"),
          `(${this.policy.with_check_expression})`,
        ),
      );
    }

    return ctx.joinLines(lines);
  }
}
