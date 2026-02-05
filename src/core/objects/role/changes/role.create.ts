import { SqlFormatter } from "../../../format/index.ts";
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
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = ["CREATE ROLE"];

    // Add role name
    parts.push(this.role.name);

    // Add options (only non-default values)
    const roleOptions: string[] = [];

    // SUPERUSER (default is NOSUPERUSER)
    if (this.role.is_superuser) {
      roleOptions.push("SUPERUSER");
    }

    // CREATEDB (default is NOCREATEDB)
    if (this.role.can_create_databases) {
      roleOptions.push("CREATEDB");
    }

    // CREATEROLE (default is NOCREATEROLE)
    if (this.role.can_create_roles) {
      roleOptions.push("CREATEROLE");
    }

    // INHERIT (default is INHERIT, so only print if false)
    if (!this.role.can_inherit) {
      roleOptions.push("NOINHERIT");
    }

    // LOGIN (default is NOLOGIN)
    if (this.role.can_login) {
      roleOptions.push("LOGIN");
    }

    // REPLICATION (default is NOREPLICATION)
    if (this.role.can_replicate) {
      roleOptions.push("REPLICATION");
    }

    // BYPASSRLS (default is NOBYPASSRLS)
    if (this.role.can_bypass_rls) {
      roleOptions.push("BYPASSRLS");
    }

    // CONNECTION LIMIT
    if (
      this.role.connection_limit !== null &&
      this.role.connection_limit !== -1
    ) {
      roleOptions.push(`CONNECTION LIMIT ${this.role.connection_limit}`);
    }

    if (roleOptions.length > 0) {
      parts.push("WITH", roleOptions.join(" "));
    }

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const lines: string[] = [
      `${formatter.keyword("CREATE")} ${formatter.keyword("ROLE")} ${this.role.name}`,
    ];

    const options: string[] = [];

    if (this.role.is_superuser) {
      options.push(formatter.keyword("SUPERUSER"));
    }

    if (this.role.can_create_databases) {
      options.push(formatter.keyword("CREATEDB"));
    }

    if (this.role.can_create_roles) {
      options.push(formatter.keyword("CREATEROLE"));
    }

    if (!this.role.can_inherit) {
      options.push(formatter.keyword("NOINHERIT"));
    }

    if (this.role.can_login) {
      options.push(formatter.keyword("LOGIN"));
    }

    if (this.role.can_replicate) {
      options.push(formatter.keyword("REPLICATION"));
    }

    if (this.role.can_bypass_rls) {
      options.push(formatter.keyword("BYPASSRLS"));
    }

    if (
      this.role.connection_limit !== null &&
      this.role.connection_limit !== -1
    ) {
      options.push(
        `${formatter.keyword("CONNECTION")} ${formatter.keyword("LIMIT")} ${this.role.connection_limit}`,
      );
    }

    if (options.length > 0) {
      lines.push(formatter.keyword("WITH"));
      const indent = formatter.indent(1);
      lines.push(...options.map((opt) => `${indent}${opt}`));
    }

    return lines.join("\n");
  }
}
