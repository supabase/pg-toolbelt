import type { SensitiveInfo } from "../../../sensitive.types.ts";
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

  get sensitiveInfo(): SensitiveInfo[] {
    if (this.role.can_login) {
      return [
        {
          type: "role_password",
          objectType: "role",
          objectName: this.role.name,
          field: "password",
          placeholder: "<your-password-here>",
          instruction: `Role ${this.role.name} requires a password to be set manually. Run: ALTER ROLE ${this.role.name} PASSWORD '<your-password-here>';`,
        },
      ];
    }
    return [];
  }

  serialize(): string {
    const commentParts: string[] = [];
    const sqlParts: string[] = [];

    // Add warning comment if role requires password
    if (this.role.can_login) {
      commentParts.push(
        "-- WARNING: Role requires password to be set manually",
        `-- Run: ALTER ROLE ${this.role.name} PASSWORD '<your-password-here>';`,
      );
    }

    sqlParts.push("CREATE ROLE");

    // Add role name
    sqlParts.push(this.role.name);

    // Add options (only non-default values)
    const options: string[] = [];

    // SUPERUSER (default is NOSUPERUSER)
    if (this.role.is_superuser) {
      options.push("SUPERUSER");
    }

    // CREATEDB (default is NOCREATEDB)
    if (this.role.can_create_databases) {
      options.push("CREATEDB");
    }

    // CREATEROLE (default is NOCREATEROLE)
    if (this.role.can_create_roles) {
      options.push("CREATEROLE");
    }

    // INHERIT (default is INHERIT, so only print if false)
    if (!this.role.can_inherit) {
      options.push("NOINHERIT");
    }

    // LOGIN (default is NOLOGIN)
    if (this.role.can_login) {
      options.push("LOGIN");
    }

    // REPLICATION (default is NOREPLICATION)
    if (this.role.can_replicate) {
      options.push("REPLICATION");
    }

    // BYPASSRLS (default is NOBYPASSRLS)
    if (this.role.can_bypass_rls) {
      options.push("BYPASSRLS");
    }

    // CONNECTION LIMIT
    if (
      this.role.connection_limit !== null &&
      this.role.connection_limit !== -1
    ) {
      options.push(`CONNECTION LIMIT ${this.role.connection_limit}`);
    }

    if (options.length > 0) {
      sqlParts.push("WITH", options.join(" "));
    }

    const sql = sqlParts.join(" ");
    return commentParts.length > 0 ? `${commentParts.join("\n")}\n${sql}` : sql;
  }
}
