import { formatObjectPrivilegeList } from "../../../base.privilege.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { Server } from "../server.model.ts";
import { AlterServerChange } from "./server.base.ts";

export type ServerPrivilege =
  | GrantServerPrivileges
  | RevokeServerPrivileges
  | RevokeGrantOptionServerPrivileges;

/**
 * Grant privileges on a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON SERVER server_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantServerPrivileges extends AlterServerChange {
  public readonly server: Server;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    server: Server;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.server = props.server;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.server.stableId, this.grantee)];
  }

  get requires() {
    return [this.server.stableId, stableId.role(this.grantee)];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantServerPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? ctx.keyword("WITH GRANT OPTION") : "";
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SERVER", list, this.version, ctx.keyword);
    const head = ctx.line(
      ctx.keyword("GRANT"),
      privSql,
      ctx.keyword("ON SERVER"),
      this.server.name,
      ctx.keyword("TO"),
      this.grantee,
    );
    return withGrant ? `${head} ${withGrant}` : head;
  }
}

/**
 * Revoke privileges on a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON SERVER server_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeServerPrivileges extends AlterServerChange {
  public readonly server: Server;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    server: Server;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.server = props.server;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.server.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.server.stableId, this.grantee),
      this.server.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SERVER", list, this.version, ctx.keyword);
    return ctx.line(
      ctx.keyword("REVOKE"),
      privSql,
      ctx.keyword("ON SERVER"),
      this.server.name,
      ctx.keyword("FROM"),
      this.grantee,
    );
  }
}

/**
 * Revoke grant option for privileges on a server.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionServerPrivileges extends AlterServerChange {
  public readonly server: Server;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    server: Server;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.server = props.server;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.server.stableId, this.grantee),
      this.server.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const privSql = formatObjectPrivilegeList(
      "SERVER",
      this.privilegeNames,
      this.version,
      ctx.keyword,
    );
    return ctx.line(
      ctx.keyword("REVOKE GRANT OPTION FOR"),
      privSql,
      ctx.keyword("ON SERVER"),
      this.server.name,
      ctx.keyword("FROM"),
      this.grantee,
    );
  }
}
