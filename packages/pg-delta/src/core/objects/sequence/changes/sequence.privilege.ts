import { Effect } from "effect";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { ensureUniformGrantablePrivileges } from "../../invariants.ts";
import { stableId } from "../../utils.ts";
import type { Sequence } from "../sequence.model.ts";
import { AlterSequenceChange } from "./sequence.base.ts";

export type SequencePrivilege =
  | GrantSequencePrivileges
  | RevokeSequencePrivileges
  | RevokeGrantOptionSequencePrivileges;

/**
 * Grant privileges on a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-grant.html
 *
 * Synopsis
 * ```sql
 * GRANT { { USAGE | SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { SEQUENCE sequence_name [, ...]
 *          | ALL SEQUENCES IN SCHEMA schema_name [, ...] }
 *     TO role_specification [, ...] [ WITH GRANT OPTION ]
 *     [ GRANTED BY role_specification ]
 * ```
 */
export class GrantSequencePrivileges extends AlterSequenceChange {
  public readonly sequence: Sequence;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    sequence: Sequence;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.sequence = props.sequence;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.sequence.stableId, this.grantee)];
  }

  get requires() {
    return [this.sequence.stableId, stableId.role(this.grantee)];
  }

  serialize() {
    const self = this;
    return Effect.gen(function* () {
      yield* ensureUniformGrantablePrivileges(
        self.privileges,
        "GrantSequencePrivileges expects privileges with uniform grantable flag",
      );
      const withGrant = self.privileges.some((p) => p.grantable)
        ? " WITH GRANT OPTION"
        : "";
      const kindPrefix = getObjectKindPrefix("SEQUENCE");
      const list = self.privileges.map((p) => p.privilege);
      const privSql = formatObjectPrivilegeList("SEQUENCE", list, self.version);
      const sequenceName = `${self.sequence.schema}.${self.sequence.name}`;
      return `GRANT ${privSql} ${kindPrefix} ${sequenceName} TO ${self.grantee}${withGrant}`;
    });
  }
}

/**
 * Revoke privileges on a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 *
 * Synopsis
 * ```sql
 * REVOKE [ GRANT OPTION FOR ]
 *     { { USAGE | SELECT | UPDATE }
 *     [, ...] | ALL [ PRIVILEGES ] }
 *     ON { SEQUENCE sequence_name [, ...]
 *          | ALL SEQUENCES IN SCHEMA schema_name [, ...] }
 *     FROM role_specification [, ...]
 *     [ GRANTED BY role_specification ]
 *     [ CASCADE | RESTRICT ]
 * ```
 */
export class RevokeSequencePrivileges extends AlterSequenceChange {
  public readonly sequence: Sequence;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    sequence: Sequence;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.sequence = props.sequence;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    // Return ACL ID for dependency tracking, even though this is an ALTER operation
    // Phase assignment now uses operation type, so this won't affect phase placement
    return [stableId.acl(this.sequence.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.sequence.stableId, this.grantee),
      this.sequence.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize() {
    const kindPrefix = getObjectKindPrefix("SEQUENCE");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("SEQUENCE", list, this.version);
    const sequenceName = `${this.sequence.schema}.${this.sequence.name}`;
    return Effect.succeed(
      `REVOKE ${privSql} ${kindPrefix} ${sequenceName} FROM ${this.grantee}`,
    );
  }
}

/**
 * Revoke grant option for privileges on a sequence.
 *
 * This removes the ability to grant the privilege to others, but keeps the privilege itself.
 *
 * @see https://www.postgresql.org/docs/17/sql-revoke.html
 */
export class RevokeGrantOptionSequencePrivileges extends AlterSequenceChange {
  public readonly sequence: Sequence;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    sequence: Sequence;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.sequence = props.sequence;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.sequence.stableId, this.grantee),
      this.sequence.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize() {
    const kindPrefix = getObjectKindPrefix("SEQUENCE");
    const privSql = formatObjectPrivilegeList(
      "SEQUENCE",
      this.privilegeNames,
      this.version,
    );
    const sequenceName = `${this.sequence.schema}.${this.sequence.name}`;
    return Effect.succeed(
      `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${sequenceName} FROM ${this.grantee}`,
    );
  }
}
