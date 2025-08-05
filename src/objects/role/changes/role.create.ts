import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

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
export class CreateRole extends CreateChange {
  public readonly role: Role;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  serialize(): string {
    const parts: string[] = ["CREATE ROLE"];

    // Add role name
    parts.push(quoteIdentifier(this.role.role_name));

    // Add options
    const options: string[] = [];

    // SUPERUSER
    if (this.role.is_superuser) {
      options.push("SUPERUSER");
    } else {
      options.push("NOSUPERUSER");
    }

    // CREATEDB
    if (this.role.can_create_databases) {
      options.push("CREATEDB");
    } else {
      options.push("NOCREATEDB");
    }

    // CREATEROLE
    if (this.role.can_create_roles) {
      options.push("CREATEROLE");
    } else {
      options.push("NOCREATEROLE");
    }

    // INHERIT
    if (this.role.can_inherit) {
      options.push("INHERIT");
    } else {
      options.push("NOINHERIT");
    }

    // LOGIN
    if (this.role.can_login) {
      options.push("LOGIN");
    } else {
      options.push("NOLOGIN");
    }

    // REPLICATION
    if (this.role.can_replicate) {
      options.push("REPLICATION");
    } else {
      options.push("NOREPLICATION");
    }

    // BYPASSRLS
    if (this.role.can_bypass_rls) {
      options.push("BYPASSRLS");
    } else {
      options.push("NOBYPASSRLS");
    }

    // CONNECTION LIMIT
    if (this.role.connection_limit !== null) {
      options.push(`CONNECTION LIMIT ${this.role.connection_limit}`);
    }

    if (options.length > 0) {
      parts.push("WITH", options.join(" "));
    }

    return parts.join(" ");
  }
}
