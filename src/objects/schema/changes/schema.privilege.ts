import { BaseChange } from "../../base.change.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import type { Schema } from "../schema.model.ts";

export type SchemaPrivilege =
  | GrantSchemaPrivileges
  | RevokeSchemaPrivileges
  | RevokeGrantOptionSchemaPrivileges;

/**
 * Grant privileges on a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { CREATE | USAGE } [, ...] | ALL [ PRIVILEGES ] }
 *    ON SCHEMA schema_name [, ...]
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantSchemaPrivileges extends BaseChange {
  public readonly schema: Schema;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "schema" as const;

  constructor(props: {
    schema: Schema;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.schema = props.schema;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.schema.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantSchemaPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("SCHEMA");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SCHEMA", list, this.version);
    const schemaName = this.schema.schema;
    return `GRANT ${privSql} ${kindPrefix} ${schemaName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a schema.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { CREATE | USAGE } [, ...] | ALL [ PRIVILEGES ] }
 *     ON SCHEMA schema_name [, ...]
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeSchemaPrivileges extends BaseChange {
  public readonly schema: Schema;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "schema" as const;

  constructor(props: {
    schema: Schema;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.schema = props.schema;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.schema.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("SCHEMA");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SCHEMA", list, this.version);
    const schemaName = this.schema.schema;
    return `REVOKE ${privSql} ${kindPrefix} ${schemaName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a schema.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionSchemaPrivileges extends BaseChange {
  public readonly schema: Schema;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "schema" as const;

  constructor(props: {
    schema: Schema;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.schema = props.schema;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.schema.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("SCHEMA");
    const privSql = formatObjectPrivilegeList(
      "SCHEMA",
      this.privilegeNames,
      this.version,
    );
    const schemaName = this.schema.schema;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${schemaName} FROM ${this.grantee}`;
  }
}
