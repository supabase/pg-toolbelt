import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { Table } from "../table.model.ts";
import { AlterTableChange } from "./table.base.ts";

export type TablePrivilege =
  | GrantTablePrivileges
  | RevokeTablePrivileges
  | RevokeGrantOptionTablePrivileges;

/**
 * Grant privileges on a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] table_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     TO role_specification [, ...] [ WITH GRANT OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantTablePrivileges extends AlterTableChange {
  public readonly table: Table;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    table: Table;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.table = props.table;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.table.stableId, this.grantee)];
  }

  get requires() {
    return [this.table.stableId, stableId.role(this.grantee)];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantTablePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? ctx.keyword("WITH GRANT OPTION") : "";
    const kindPrefix = ctx.keyword(getObjectKindPrefix("TABLE"));
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TABLE", list, this.version, ctx.keyword);
    const tableName = `${this.table.schema}.${this.table.name}`;
    const columnSpec =
      this.columns && this.columns.length > 0
        ? ` (${this.columns.join(", ")})`
        : "";
    const head = ctx.line(
      ctx.keyword("GRANT"),
      `${privSql}${columnSpec}`,
      kindPrefix,
      tableName,
      ctx.keyword("TO"),
      this.grantee,
    );
    return withGrant ? `${head} ${withGrant}` : head;
  }
}

/**
 * Revoke privileges on a table.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { [ TABLE ] table_name [, ...]
 *          | ALL TABLES IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeTablePrivileges extends AlterTableChange {
  public readonly table: Table;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    table: Table;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.table = props.table;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.columns = props.columns;
    this.version = props.version;
  }

  get drops() {
    // Return ACL ID for dependency tracking, even though this is an ALTER operation
    // Phase assignment now uses operation type, so this won't affect phase placement
    return [stableId.acl(this.table.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.table.stableId, this.grantee),
      this.table.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const kindPrefix = ctx.keyword(getObjectKindPrefix("TABLE"));
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("TABLE", list, this.version, ctx.keyword);
    const tableName = `${this.table.schema}.${this.table.name}`;
    const columnSpec =
      this.columns && this.columns.length > 0
        ? ` (${this.columns.join(", ")})`
        : "";
    return ctx.line(
      ctx.keyword("REVOKE"),
      `${privSql}${columnSpec}`,
      kindPrefix,
      tableName,
      ctx.keyword("FROM"),
      this.grantee,
    );
  }
}

/**
 * Revoke grant option for privileges on a table.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionTablePrivileges extends AlterTableChange {
  public readonly table: Table;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly columns?: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    table: Table;
    grantee: string;
    privilegeNames: string[];
    columns?: string[];
    version?: number;
  }) {
    super();
    this.table = props.table;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.columns = props.columns;
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.table.stableId, this.grantee),
      this.table.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const kindPrefix = ctx.keyword(getObjectKindPrefix("TABLE"));
    const privSql = formatObjectPrivilegeList(
      "TABLE",
      this.privilegeNames,
      this.version,
      ctx.keyword,
    );
    const tableName = `${this.table.schema}.${this.table.name}`;
    const columnSpec =
      this.columns && this.columns.length > 0
        ? ` (${this.columns.join(", ")})`
        : "";
    return ctx.line(
      ctx.keyword("REVOKE GRANT OPTION FOR"),
      `${privSql}${columnSpec}`,
      kindPrefix,
      tableName,
      ctx.keyword("FROM"),
      this.grantee,
    );
  }
}
