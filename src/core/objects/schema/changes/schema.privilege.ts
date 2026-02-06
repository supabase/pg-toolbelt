import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { Schema } from "../schema.model.ts";
import { AlterSchemaChange } from "./schema.base.ts";

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
export class GrantSchemaPrivileges extends AlterSchemaChange {
  public readonly schema: Schema;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

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

  get creates() {
    return [stableId.acl(this.schema.stableId, this.grantee)];
  }

  get requires() {
    return [this.schema.stableId, stableId.role(this.grantee)];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantSchemaPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? ctx.keyword("WITH GRANT OPTION") : "";
    const kindPrefix = ctx.keyword(getObjectKindPrefix("SCHEMA"));
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SCHEMA", list, this.version, ctx.keyword);
    const schemaName = this.schema.name;
    const head = ctx.line(
      ctx.keyword("GRANT"),
      privSql,
      kindPrefix,
      schemaName,
      ctx.keyword("TO"),
      this.grantee,
    );
    return withGrant ? `${head} ${withGrant}` : head;
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
export class RevokeSchemaPrivileges extends AlterSchemaChange {
  public readonly schema: Schema;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

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

  get drops() {
    // Return ACL ID for dependency tracking, even though this is an ALTER operation
    // Phase assignment now uses operation type, so this won't affect phase placement
    return [stableId.acl(this.schema.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.schema.stableId, this.grantee),
      this.schema.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const kindPrefix = ctx.keyword(getObjectKindPrefix("SCHEMA"));
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SCHEMA", list, this.version, ctx.keyword);
    const schemaName = this.schema.name;
    return ctx.line(
      ctx.keyword("REVOKE"),
      privSql,
      kindPrefix,
      schemaName,
      ctx.keyword("FROM"),
      this.grantee,
    );
  }
}

/**
 * Revoke grant option for privileges on a schema.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionSchemaPrivileges extends AlterSchemaChange {
  public readonly schema: Schema;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

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

  get requires() {
    return [
      stableId.acl(this.schema.stableId, this.grantee),
      this.schema.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const kindPrefix = ctx.keyword(getObjectKindPrefix("SCHEMA"));
    const privSql = formatObjectPrivilegeList(
      "SCHEMA",
      this.privilegeNames,
      this.version,
      ctx.keyword,
    );
    const schemaName = this.schema.name;
    return ctx.line(
      ctx.keyword("REVOKE GRANT OPTION FOR"),
      privSql,
      kindPrefix,
      schemaName,
      ctx.keyword("FROM"),
      this.grantee,
    );
  }
}
