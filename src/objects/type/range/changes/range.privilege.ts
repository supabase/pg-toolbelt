import { BaseChange } from "../../../base.change.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../../base.privilege.ts";
import type { Range } from "../range.model.ts";

export type RangePrivilege =
  | GrantRangePrivileges
  | RevokeRangePrivileges
  | RevokeGrantOptionRangePrivileges;

/**
 * Grant privileges on a range type.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON TYPE type_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantRangePrivileges extends BaseChange {
  public readonly range: Range;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "range" as const;

  constructor(props: {
    range: Range;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.range = props.range;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.range.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantRangePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const rangeName = `${this.range.schema}.${this.range.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${rangeName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a range type.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON TYPE type_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeRangePrivileges extends BaseChange {
  public readonly range: Range;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "range" as const;

  constructor(props: {
    range: Range;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.range = props.range;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.range.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("TYPE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TYPE", list, this.version);
    const rangeName = `${this.range.schema}.${this.range.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${rangeName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a range type.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionRangePrivileges extends BaseChange {
  public readonly range: Range;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "range" as const;

  constructor(props: {
    range: Range;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.range = props.range;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.range.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("TYPE");
    const privSql = formatObjectPrivilegeList(
      "TYPE",
      this.privilegeNames,
      this.version,
    );
    const rangeName = `${this.range.schema}.${this.range.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${rangeName} FROM ${this.grantee}`;
  }
}
