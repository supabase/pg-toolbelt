import { BaseChange } from "../../base.change.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import type { Domain } from "../domain.model.ts";

export type DomainPrivilege =
  | GrantDomainPrivileges
  | RevokeDomainPrivileges
  | RevokeGrantOptionDomainPrivileges;

/**
 * Grant privileges on a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { USAGE | ALL [ PRIVILEGES ] }
 *    ON DOMAIN domain_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantDomainPrivileges extends BaseChange {
  public readonly domain: Domain;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "domain" as const;

  constructor(props: {
    domain: Domain;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.domain = props.domain;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.domain.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantDomainPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("DOMAIN");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("DOMAIN", list, this.version);
    const domainName = `${this.domain.schema}.${this.domain.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${domainName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { USAGE | ALL [ PRIVILEGES ] }
 *     ON DOMAIN domain_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeDomainPrivileges extends BaseChange {
  public readonly domain: Domain;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "domain" as const;

  constructor(props: {
    domain: Domain;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.domain = props.domain;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.domain.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("DOMAIN");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("DOMAIN", list, this.version);
    const domainName = `${this.domain.schema}.${this.domain.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${domainName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a domain.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionDomainPrivileges extends BaseChange {
  public readonly domain: Domain;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "domain" as const;

  constructor(props: {
    domain: Domain;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.domain = props.domain;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.domain.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("DOMAIN");
    const privSql = formatObjectPrivilegeList(
      "DOMAIN",
      this.privilegeNames,
      this.version,
    );
    const domainName = `${this.domain.schema}.${this.domain.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${domainName} FROM ${this.grantee}`;
  }
}
