import { BaseChange } from "../../base.change.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import type { View } from "../view.model.ts";

export type ViewPrivilege =
  | GrantViewPrivileges
  | RevokeViewPrivileges
  | RevokeGrantOptionViewPrivileges;

/**
 * Grant privileges on a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] view_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     TO role_specification [, ...] [ WITH GRANT OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantViewPrivileges extends BaseChange {
  public readonly view: View;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "view" as const;

  constructor(props: {
    view: View;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.view = props.view;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns
      ? [...new Set(props.columns)].sort()
      : undefined;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.view.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantViewPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("VIEW");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("VIEW", list, this.version);
    const viewName = `${this.view.schema}.${this.view.name}`;

    // Add column list if present
    const columnClause = this.columns ? ` (${this.columns.join(", ")})` : "";

    return `GRANT ${privSql}${columnClause} ${kindPrefix} ${viewName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] view_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeViewPrivileges extends BaseChange {
  public readonly view: View;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "view" as const;

  constructor(props: {
    view: View;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.view = props.view;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns
      ? [...new Set(props.columns)].sort()
      : undefined;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.view.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("VIEW");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("VIEW", list, this.version);
    const viewName = `${this.view.schema}.${this.view.name}`;

    // Add column list if present
    const columnClause = this.columns ? ` (${this.columns.join(", ")})` : "";

    return `REVOKE ${privSql}${columnClause} ${kindPrefix} ${viewName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a view.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionViewPrivileges extends BaseChange {
  public readonly view: View;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "view" as const;

  constructor(props: {
    view: View;
    grantee: string;
    privilegeNames: string[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.view = props.view;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.columns = props.columns
      ? [...new Set(props.columns)].sort()
      : undefined;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.view.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("VIEW");
    const privSql = formatObjectPrivilegeList(
      "VIEW",
      this.privilegeNames,
      this.version,
    );
    const viewName = `${this.view.schema}.${this.view.name}`;

    // Add column list if present
    const columnClause = this.columns ? ` (${this.columns.join(", ")})` : "";

    return `REVOKE GRANT OPTION FOR ${privSql}${columnClause} ${kindPrefix} ${viewName} FROM ${this.grantee}`;
  }
}
