import { Effect } from "effect";
import { formatObjectPrivilegeList } from "../../../base.privilege.ts";
import { ensureUniformGrantablePrivileges } from "../../../invariants.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { AlterForeignDataWrapperChange } from "./foreign-data-wrapper.base.ts";

export type ForeignDataWrapperPrivilege =
  | GrantForeignDataWrapperPrivileges
  | RevokeForeignDataWrapperPrivileges
  | RevokeGrantOptionForeignDataWrapperPrivileges;

/**
 * Grant privileges on a foreign data wrapper.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON FOREIGN DATA WRAPPER name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantForeignDataWrapperPrivileges extends AlterForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    foreignDataWrapper: ForeignDataWrapper;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.foreignDataWrapper.stableId, this.grantee)];
  }

  get requires() {
    return [this.foreignDataWrapper.stableId, stableId.role(this.grantee)];
  }

  serialize() {
    const self = this;
    return Effect.gen(function* () {
      yield* ensureUniformGrantablePrivileges(
        self.privileges,
        "GrantForeignDataWrapperPrivileges expects privileges with uniform grantable flag",
      );
      const withGrant = self.privileges.some((p) => p.grantable)
        ? " WITH GRANT OPTION"
        : "";
      const list = self.privileges.map((p) => p.privilege);
      const privSql = formatObjectPrivilegeList(
        "FOREIGN DATA WRAPPER",
        list,
        self.version,
      );
      return `GRANT ${privSql} ON FOREIGN DATA WRAPPER ${self.foreignDataWrapper.name} TO ${self.grantee}${withGrant}`;
    });
  }
}

/**
 * Revoke privileges on a foreign data wrapper.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON FOREIGN DATA WRAPPER name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeForeignDataWrapperPrivileges extends AlterForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    foreignDataWrapper: ForeignDataWrapper;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [stableId.acl(this.foreignDataWrapper.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.foreignDataWrapper.stableId, this.grantee),
      this.foreignDataWrapper.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize() {
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList(
      "FOREIGN DATA WRAPPER",
      list,
      this.version,
    );
    return Effect.succeed(
      `REVOKE ${privSql} ON FOREIGN DATA WRAPPER ${this.foreignDataWrapper.name} FROM ${this.grantee}`,
    );
  }
}

/**
 * Revoke grant option for privileges on a foreign data wrapper.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionForeignDataWrapperPrivileges extends AlterForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    foreignDataWrapper: ForeignDataWrapper;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.foreignDataWrapper.stableId, this.grantee),
      this.foreignDataWrapper.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize() {
    const privSql = formatObjectPrivilegeList(
      "FOREIGN DATA WRAPPER",
      this.privilegeNames,
      this.version,
    );
    return Effect.succeed(
      `REVOKE GRANT OPTION FOR ${privSql} ON FOREIGN DATA WRAPPER ${this.foreignDataWrapper.name} FROM ${this.grantee}`,
    );
  }
}
