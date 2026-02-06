import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Role } from "../role.model.ts";
import { CreateRoleChange, DropRoleChange } from "./role.base.ts";

export type RolePrivilege =
  | GrantRoleMembership
  | RevokeRoleMembership
  | RevokeRoleMembershipOptions
  | GrantRoleDefaultPrivileges
  | RevokeRoleDefaultPrivileges;

/**
 * Grant role membership.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT role_name [, ...] TO role_specification [, ...]
 *     [ WITH ADMIN OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantRoleMembership extends CreateRoleChange {
  public readonly role: Role;
  public readonly member: string;
  public readonly options: {
    admin: boolean;
    inherit?: boolean | null;
    set?: boolean | null;
  };
  public readonly scope = "membership" as const;

  constructor(props: {
    role: Role;
    member: string;
    options: { admin: boolean; inherit?: boolean | null; set?: boolean | null };
  }) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.options = props.options;
  }

  get creates() {
    return [stableId.membership(this.role.name, this.member)];
  }

  get requires() {
    return [this.role.stableId, stableId.role(this.member)];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    // On creation, only emit ADMIN OPTION; leave INHERIT/SET to defaults
    if (this.options.admin) {
      return ctx.line(
        ctx.keyword("GRANT"),
        this.role.name,
        ctx.keyword("TO"),
        this.member,
        ctx.keyword("WITH"),
        ctx.keyword("ADMIN OPTION"),
      );
    }
    return ctx.line(
      ctx.keyword("GRANT"),
      this.role.name,
      ctx.keyword("TO"),
      this.member,
    );
  }
}

/**
 * Revoke role membership.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ ADMIN OPTION FOR ] role_name [, ...] FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeRoleMembership extends DropRoleChange {
  public readonly role: Role;
  public readonly member: string;
  public readonly scope = "membership" as const;

  constructor(props: { role: Role; member: string }) {
    super();
    this.role = props.role;
    this.member = props.member;
  }

  get drops() {
    return [stableId.membership(this.role.name, this.member)];
  }

  get requires() {
    return [
      stableId.membership(this.role.name, this.member),
      stableId.role(this.member),
      this.role.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("REVOKE"),
      this.role.name,
      ctx.keyword("FROM"),
      this.member,
    );
  }
}

/**
 * Revoke membership options for a role.
 *
 * This removes specific options (ADMIN, INHERIT, SET) from a role membership,
 * but keeps the membership itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeRoleMembershipOptions extends DropRoleChange {
  public readonly role: Role;
  public readonly member: string;
  public readonly admin?: boolean;
  public readonly inherit?: boolean;
  public readonly set?: boolean;
  public readonly scope = "membership" as const;

  constructor(props: {
    role: Role;
    member: string;
    admin?: boolean;
    inherit?: boolean;
    set?: boolean;
  }) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.admin = props.admin;
    this.inherit = props.inherit;
    this.set = props.set;
  }

  get requires() {
    return [
      stableId.membership(this.role.name, this.member),
      stableId.role(this.member),
      this.role.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const parts: string[] = [];
    if (this.admin) parts.push(ctx.keyword("ADMIN OPTION"));
    if (this.inherit) parts.push(ctx.keyword("INHERIT OPTION"));
    if (this.set) parts.push(ctx.keyword("SET OPTION"));
    return ctx.line(
      ctx.keyword("REVOKE"),
      parts.join(" "),
      ctx.keyword("FOR"),
      this.role.name,
      ctx.keyword("FROM"),
      this.member,
    );
  }
}

/**
 * Grant default privileges for a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html
 */
export class GrantRoleDefaultPrivileges extends CreateRoleChange {
  public readonly role: Role;
  public readonly inSchema: string | null;
  public readonly objtype: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number;
  public readonly scope = "default_privilege" as const;

  constructor(props: {
    role: Role;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version: number;
  }) {
    super();
    this.role = props.role;
    this.inSchema = props.inSchema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [
      stableId.defacl(
        this.role.name,
        this.objtype,
        this.inSchema,
        this.grantee,
      ),
    ];
  }

  get requires() {
    return [
      this.role.stableId,
      stableId.role(this.grantee),
      ...(this.inSchema ? [stableId.schema(this.inSchema)] : []),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const scope = this.inSchema
      ? ctx.line(ctx.keyword("IN SCHEMA"), this.inSchema)
      : "";
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantRoleDefaultPrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? ctx.keyword("WITH GRANT OPTION") : "";
    const privSql = formatPrivilegeList(
      this.objtype,
      this.privileges.map((p) => p.privilege),
      this.version,
    );
    const head = ctx.line(
      ctx.keyword("ALTER DEFAULT PRIVILEGES"),
      ctx.keyword("FOR ROLE"),
      this.role.name,
      scope,
    );
    const grant = ctx.line(
      ctx.keyword("GRANT"),
      privSql,
      ctx.keyword("ON"),
      ctx.keyword(objtypeToKeyword(this.objtype)),
      ctx.keyword("TO"),
      this.grantee,
    );
    const base = ctx.line(head, grant);
    return withGrant ? ctx.line(base, withGrant) : base;
  }
}

/**
 * Revoke default privileges for a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html
 */
export class RevokeRoleDefaultPrivileges extends DropRoleChange {
  public readonly role: Role;
  public readonly inSchema: string | null;
  public readonly objtype: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number;
  public readonly scope = "default_privilege" as const;

  constructor(props: {
    role: Role;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version: number;
  }) {
    super();
    this.role = props.role;
    this.inSchema = props.inSchema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    return [
      stableId.defacl(
        this.role.name,
        this.objtype,
        this.inSchema,
        this.grantee,
      ),
    ];
  }

  get requires() {
    return [
      stableId.defacl(
        this.role.name,
        this.objtype,
        this.inSchema,
        this.grantee,
      ),
      this.role.stableId,
      stableId.role(this.grantee),
      ...(this.inSchema ? [stableId.schema(this.inSchema)] : []),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const scope = this.inSchema
      ? ctx.line(ctx.keyword("IN SCHEMA"), this.inSchema)
      : "";
    const grantOptionPrivs = this.privileges
      .filter((p) => p.grantable)
      .map((p) => p.privilege);
    const basePrivs = this.privileges
      .filter((p) => !p.grantable)
      .map((p) => p.privilege);
    const hasGrantOption = grantOptionPrivs.length > 0;
    const hasBase = basePrivs.length > 0;
    if (hasGrantOption && hasBase) {
      throw new Error(
        "AlterDefaultPrivilegesRevoke expects privileges from a single revoke kind",
      );
    }
    if (hasGrantOption) {
      const privSql = formatPrivilegeList(
        this.objtype,
        grantOptionPrivs,
        this.version,
      );
      const head = ctx.line(
        ctx.keyword("ALTER DEFAULT PRIVILEGES"),
        ctx.keyword("FOR ROLE"),
        this.role.name,
        scope,
      );
      const revoke = ctx.line(
        ctx.keyword("REVOKE GRANT OPTION FOR"),
        privSql,
        ctx.keyword("ON"),
        ctx.keyword(objtypeToKeyword(this.objtype)),
        ctx.keyword("FROM"),
        this.grantee,
      );
      return ctx.line(head, revoke);
    }
    const privSql = formatPrivilegeList(this.objtype, basePrivs, this.version);
    const head = ctx.line(
      ctx.keyword("ALTER DEFAULT PRIVILEGES"),
      ctx.keyword("FOR ROLE"),
      this.role.name,
      scope,
    );
    const revoke = ctx.line(
      ctx.keyword("REVOKE"),
      privSql,
      ctx.keyword("ON"),
      ctx.keyword(objtypeToKeyword(this.objtype)),
      ctx.keyword("FROM"),
      this.grantee,
    );
    return ctx.line(head, revoke);
  }
}

// Helper functions for default privileges
function objtypeToKeyword(objtype: string): string {
  switch (objtype) {
    case "r":
      return "TABLES";
    case "S":
      return "SEQUENCES";
    case "f":
      return "ROUTINES";
    case "T":
      return "TYPES";
    case "n":
      return "SCHEMAS";
    default:
      return objtype;
  }
}

function defaultPrivilegeUniverse(objtype: string, version: number): string[] {
  // Full privilege sets per object kind for ALTER DEFAULT PRIVILEGES
  // Keep names aligned with pg_catalog privilege_type values
  switch (objtype) {
    case "r": {
      // TABLES
      // MAINTAIN exists on PostgreSQL >= 17
      const includesMaintain = version >= 170000;
      return [
        "DELETE",
        "INSERT",
        ...(includesMaintain ? (["MAINTAIN"] as const) : []),
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
      ];
    }
    case "S": // SEQUENCES
      return ["SELECT", "UPDATE", "USAGE"].sort();
    case "f": // ROUTINES (FUNCTIONS)
      return ["EXECUTE"];
    case "T": // TYPES
      return ["USAGE"];
    case "n": // SCHEMAS
      return ["CREATE", "USAGE"].sort();
    default:
      return [];
  }
}

function isFullPrivilegeSet(
  objtype: string,
  list: string[],
  version: number,
): boolean {
  const uniqSorted = [...new Set(list)].sort();
  const fullSorted = [...defaultPrivilegeUniverse(objtype, version)].sort();
  if (uniqSorted.length !== fullSorted.length) return false;
  for (let i = 0; i < uniqSorted.length; i++) {
    if (uniqSorted[i] !== fullSorted[i]) return false;
  }
  return true;
}

function formatPrivilegeList(
  objtype: string,
  list: string[],
  version: number,
): string {
  const uniqSorted = [...new Set(list)].sort();
  return isFullPrivilegeSet(objtype, uniqSorted, version)
    ? "ALL"
    : uniqSorted.join(", ");
}
