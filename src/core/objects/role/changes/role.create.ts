import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Role } from "../role.model.ts";
import { CreateRoleChange } from "./role.base.ts";

/**
 * Create a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-createrole.html
 *
 * Synopsis
 * ```sql
 * CREATE ROLE name [ [ WITH ] option [ ... ] ]
 * where option can be:
 *     SUPERUSER | NOSUPERUSER
 *     | CREATEDB | NOCREATEDB
 *     | CREATEROLE | NOCREATEROLE
 *     | INHERIT | NOINHERIT
 *     | LOGIN | NOLOGIN
 *     | REPLICATION | NOREPLICATION
 *     | BYPASSRLS | NOBYPASSRLS
 *     | CONNECTION LIMIT connlimit
 *     | [ ENCRYPTED ] PASSWORD 'password' | PASSWORD NULL
 *     | VALID UNTIL 'timestamp'
 *     | IN ROLE role_name [, ...]
 *     | IN GROUP role_name [, ...]
 *     | ROLE role_name [, ...]
 *     | ADMIN role_name [, ...]
 *     | USER role_name [, ...]
 *     | SYSID uid
 * ```
 */
export class CreateRole extends CreateRoleChange {
  public readonly role: Role;
  public readonly scope = "object" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get creates() {
    return [this.role.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(ctx.keyword("CREATE"), ctx.keyword("ROLE"), this.role.name),
    ];

    const roleOptions: string[] = [];

    if (this.role.is_superuser) {
      roleOptions.push(ctx.keyword("SUPERUSER"));
    }

    if (this.role.can_create_databases) {
      roleOptions.push(ctx.keyword("CREATEDB"));
    }

    if (this.role.can_create_roles) {
      roleOptions.push(ctx.keyword("CREATEROLE"));
    }

    if (!this.role.can_inherit) {
      roleOptions.push(ctx.keyword("NOINHERIT"));
    }

    if (this.role.can_login) {
      roleOptions.push(ctx.keyword("LOGIN"));
    }

    if (this.role.can_replicate) {
      roleOptions.push(ctx.keyword("REPLICATION"));
    }

    if (this.role.can_bypass_rls) {
      roleOptions.push(ctx.keyword("BYPASSRLS"));
    }

    if (
      this.role.connection_limit !== null &&
      this.role.connection_limit !== -1
    ) {
      roleOptions.push(
        ctx.line(
          ctx.keyword("CONNECTION"),
          ctx.keyword("LIMIT"),
          this.role.connection_limit.toString(),
        ),
      );
    }

    if (roleOptions.length > 0) {
      lines.push(ctx.keyword("WITH"));
      const prefix = ctx.pretty ? ctx.indent(1) : "";
      lines.push(...roleOptions.map((opt) => `${prefix}${opt}`));
    }

    return ctx.joinLines(lines);
  }
}
