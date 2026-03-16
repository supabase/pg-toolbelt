import { Effect } from "effect";
import {
  ensureSingleRevokeKind,
  ensureUniformGrantablePrivileges,
} from "../../invariants.ts";
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

  serialize() {
    // On creation, only emit ADMIN OPTION; leave INHERIT/SET to defaults
    const opts: string[] = [];
    if (this.options.admin) opts.push("ADMIN OPTION");
    const withClause = opts.length > 0 ? ` WITH ${opts.join(" ")}` : "";
    return Effect.succeed(
      `GRANT ${this.role.name} TO ${this.member}${withClause}`,
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

  serialize() {
    return Effect.succeed(`REVOKE ${this.role.name} FROM ${this.member}`);
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

  serialize() {
    const parts: string[] = [];
    if (this.admin) parts.push("ADMIN OPTION");
    if (this.inherit) parts.push("INHERIT OPTION");
    if (this.set) parts.push("SET OPTION");
    return Effect.succeed(
      `REVOKE ${parts.join(" ")} FOR ${this.role.name} FROM ${this.member}`,
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

  serialize() {
    const self = this;
    return Effect.gen(function* () {
      const scope = self.inSchema ? ` IN SCHEMA ${self.inSchema}` : "";
      yield* ensureUniformGrantablePrivileges(
        self.privileges,
        "GrantRoleDefaultPrivileges expects privileges with uniform grantable flag",
      );
      const withGrant = self.privileges.some((p) => p.grantable)
        ? " WITH GRANT OPTION"
        : "";
      const privSql = formatPrivilegeList(
        self.objtype,
        self.privileges.map((p) => p.privilege),
        self.version,
      );
      return `ALTER DEFAULT PRIVILEGES FOR ROLE ${self.role.name}${scope} GRANT ${privSql} ON ${objtypeToKeyword(self.objtype)} TO ${self.grantee}${withGrant}`;
    });
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

  serialize() {
    const self = this;
    return Effect.gen(function* () {
      const scope = self.inSchema ? ` IN SCHEMA ${self.inSchema}` : "";
      const grantOptionPrivs = self.privileges
        .filter((p) => p.grantable)
        .map((p) => p.privilege);
      const basePrivs = self.privileges
        .filter((p) => !p.grantable)
        .map((p) => p.privilege);
      const hasGrantOption = grantOptionPrivs.length > 0;
      const hasBase = basePrivs.length > 0;
      yield* ensureSingleRevokeKind(
        hasGrantOption,
        hasBase,
        "AlterDefaultPrivilegesRevoke expects privileges from a single revoke kind",
      );
      if (hasGrantOption) {
        const privSql = formatPrivilegeList(
          self.objtype,
          grantOptionPrivs,
          self.version,
        );
        return `ALTER DEFAULT PRIVILEGES FOR ROLE ${self.role.name}${scope} REVOKE GRANT OPTION FOR ${privSql} ON ${objtypeToKeyword(self.objtype)} FROM ${self.grantee}`;
      }

      const privSql = formatPrivilegeList(
        self.objtype,
        basePrivs,
        self.version,
      );
      return `ALTER DEFAULT PRIVILEGES FOR ROLE ${self.role.name}${scope} REVOKE ${privSql} ON ${objtypeToKeyword(self.objtype)} FROM ${self.grantee}`;
    });
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
