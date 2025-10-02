import { BaseChange } from "../../base.change.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import type { Procedure } from "../procedure.model.ts";

export type ProcedurePrivilege =
  | GrantProcedurePrivileges
  | RevokeProcedurePrivileges
  | RevokeGrantOptionProcedurePrivileges;

/**
 * Grant privileges on a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { EXECUTE | ALL [ PRIVILEGES ] }
 *    ON { { FUNCTION | PROCEDURE | ROUTINE } routine_name [ ( [ [ argmode ] [ arg_name ] arg_type [, ...] ] ) ] [, ...]
 *         | ALL { FUNCTIONS | PROCEDURES | ROUTINES } IN SCHEMA schema_name [, ...] }
 *    TO role_specification [, ...] [ WITH GRANT OPTION ]
 *    [ GRANTED BY role_specification ]
 * ```
 */
export class GrantProcedurePrivileges extends BaseChange {
  public readonly procedure: Procedure;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "procedure" as const;

  constructor(props: {
    procedure: Procedure;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.procedure = props.procedure;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.procedure.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantProcedurePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("ROUTINE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("ROUTINE", list, this.version);
    const procedureName = `${this.procedure.schema}.${this.procedure.name}`;
    return `GRANT ${privSql} ${kindPrefix} ${procedureName} TO ${this.grantee}${withGrant}`;
  }
}

/**
 * Revoke privileges on a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { EXECUTE | ALL [ PRIVILEGES ] }
 *     ON { { FUNCTION | PROCEDURE | ROUTINE } function_name [ ( [ [ argmode ] [ arg_name ] arg_type [, ...] ] ) ] [, ...]
 *          | ALL { FUNCTIONS | PROCEDURES | ROUTINES } IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeProcedurePrivileges extends BaseChange {
  public readonly procedure: Procedure;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "procedure" as const;

  constructor(props: {
    procedure: Procedure;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.procedure = props.procedure;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.procedure.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("ROUTINE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("ROUTINE", list, this.version);
    const procedureName = `${this.procedure.schema}.${this.procedure.name}`;
    return `REVOKE ${privSql} ${kindPrefix} ${procedureName} FROM ${this.grantee}`;
  }
}

/**
 * Revoke grant option for privileges on a procedure.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionProcedurePrivileges extends BaseChange {
  public readonly procedure: Procedure;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "procedure" as const;

  constructor(props: {
    procedure: Procedure;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.procedure = props.procedure;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get dependencies() {
    const aclStableId = `acl:${this.procedure.stableId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix = getObjectKindPrefix("ROUTINE");
    const privSql = formatObjectPrivilegeList(
      "ROUTINE",
      this.privilegeNames,
      this.version,
    );
    const procedureName = `${this.procedure.schema}.${this.procedure.name}`;
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${procedureName} FROM ${this.grantee}`;
  }
}
