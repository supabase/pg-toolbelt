import { BaseChange } from "../../../base.change.ts";

export type AlterColumnPrivilege =
  | GrantColumnPrivileges
  | RevokeColumnPrivileges
  | RevokeGrantOptionColumnPrivileges;

export class GrantColumnPrivileges extends BaseChange {
  public readonly tableId: string;
  public readonly tableNameSql: string;
  public readonly grantee: string;
  public readonly privilege: string;
  public readonly columns: string[];
  public readonly grantable: boolean;
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "table" as const;

  constructor(props: {
    tableId: string;
    tableNameSql: string;
    grantee: string;
    privilege: string;
    columns: string[];
    grantable: boolean;
  }) {
    super();
    this.tableId = props.tableId;
    this.tableNameSql = props.tableNameSql;
    this.grantee = props.grantee;
    this.privilege = props.privilege;
    this.columns = [...new Set(props.columns)].sort();
    this.grantable = props.grantable;
  }

  get dependencies() {
    const aclcolStableId = `aclcol:${this.tableId}::grantee:${this.grantee}`;
    return [aclcolStableId];
  }

  serialize(): string {
    const withGrant = this.grantable ? " WITH GRANT OPTION" : "";
    return `GRANT ${this.privilege} (${this.columns.join(", ")}) ON TABLE ${this.tableNameSql} TO ${this.grantee}${withGrant}`;
  }
}

export class RevokeColumnPrivileges extends BaseChange {
  public readonly tableId: string;
  public readonly tableNameSql: string;
  public readonly grantee: string;
  public readonly privilege: string;
  public readonly columns: string[];
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "table" as const;

  constructor(props: {
    tableId: string;
    tableNameSql: string;
    grantee: string;
    privilege: string;
    columns: string[];
  }) {
    super();
    this.tableId = props.tableId;
    this.tableNameSql = props.tableNameSql;
    this.grantee = props.grantee;
    this.privilege = props.privilege;
    this.columns = [...new Set(props.columns)].sort();
  }

  get dependencies() {
    const aclcolStableId = `aclcol:${this.tableId}::grantee:${this.grantee}`;
    return [aclcolStableId];
  }

  serialize(): string {
    return `REVOKE ${this.privilege} (${this.columns.join(", ")}) ON TABLE ${this.tableNameSql} FROM ${this.grantee}`;
  }
}

export class RevokeGrantOptionColumnPrivileges extends BaseChange {
  public readonly tableId: string;
  public readonly tableNameSql: string;
  public readonly grantee: string;
  public readonly privilege: string;
  public readonly columns: string[];
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public readonly objectType = "table" as const;

  constructor(props: {
    tableId: string;
    tableNameSql: string;
    grantee: string;
    privilege: string;
    columns: string[];
  }) {
    super();
    this.tableId = props.tableId;
    this.tableNameSql = props.tableNameSql;
    this.grantee = props.grantee;
    this.privilege = props.privilege;
    this.columns = [...new Set(props.columns)].sort();
  }

  get dependencies() {
    const aclcolStableId = `aclcol:${this.tableId}::grantee:${this.grantee}`;
    return [aclcolStableId];
  }

  serialize(): string {
    return `REVOKE GRANT OPTION FOR ${this.privilege} (${this.columns.join(", ")}) ON TABLE ${this.tableNameSql} FROM ${this.grantee}`;
  }
}
