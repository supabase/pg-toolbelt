import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import {
  formatObjectPrivilegeList,
  getObjectKindPrefix,
} from "../../base.privilege.ts";
import { stableId } from "../../utils.ts";
import type { Aggregate } from "../aggregate.model.ts";
import { AlterAggregateChange } from "./aggregate.base.ts";

export type AggregatePrivilege =
  | GrantAggregatePrivileges
  | RevokeAggregatePrivileges
  | RevokeGrantOptionAggregatePrivileges;

/**
 * Build the signature `<schema>.<name>(<argtypes>)` for use inside
 * `GRANT`/`REVOKE ... ON FUNCTION (...)`.
 *
 * The aggregate's `identityArguments` (from
 * `pg_get_function_identity_arguments`) embeds `ORDER BY` for ordered-set
 * and hypothetical-set aggregates (`aggkind` of `o`/`h`) and `VARIADIC`
 * for variadic aggregates — both of which the GRANT parser rejects with
 * a syntax error. PostgreSQL resolves the aggregate from the positional
 * argument types alone, so use `argument_types` here regardless of
 * `aggkind`. Other aggregate DDL (`ALTER AGGREGATE`, `COMMENT ON
 * AGGREGATE`, `SECURITY LABEL ON AGGREGATE`, `DROP AGGREGATE`) accepts
 * the identity form and keeps using it.
 */
function aggregateGrantSignature(aggregate: Aggregate): string {
  const args = (aggregate.argument_types ?? []).join(", ");
  return `${aggregate.schema}.${aggregate.name}(${args})`;
}

export class GrantAggregatePrivileges extends AlterAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    aggregate: Aggregate;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get creates() {
    return [stableId.acl(this.aggregate.stableId, this.grantee)];
  }

  get requires() {
    return [this.aggregate.stableId, stableId.role(this.grantee)];
  }

  serialize(_options?: SerializeOptions): string {
    const hasGrantable = this.privileges.some((p) => p.grantable);
    const hasBase = this.privileges.some((p) => !p.grantable);
    if (hasGrantable && hasBase) {
      throw new Error(
        "GrantAggregatePrivileges expects privileges with uniform grantable flag",
      );
    }
    const withGrant = hasGrantable ? " WITH GRANT OPTION" : "";
    const kindPrefix = getObjectKindPrefix("FUNCTION");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("FUNCTION", list, this.version);
    const qualified = aggregateGrantSignature(this.aggregate);
    return `GRANT ${privSql} ${kindPrefix} ${qualified} TO ${this.grantee}${withGrant}`;
  }
}

export class RevokeAggregatePrivileges extends AlterAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    aggregate: Aggregate;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
    version?: number;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
    this.version = props.version;
  }

  get drops() {
    // Return ACL ID for dependency tracking, even though this is an ALTER operation
    // Phase assignment now uses operation type, so this won't affect phase placement
    return [stableId.acl(this.aggregate.stableId, this.grantee)];
  }

  get requires() {
    return [
      stableId.acl(this.aggregate.stableId, this.grantee),
      this.aggregate.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(_options?: SerializeOptions): string {
    const kindPrefix = getObjectKindPrefix("FUNCTION");
    const list = this.privileges.map((p) => p.privilege);
    const privSql = formatObjectPrivilegeList("FUNCTION", list, this.version);
    const qualified = aggregateGrantSignature(this.aggregate);
    return `REVOKE ${privSql} ${kindPrefix} ${qualified} FROM ${this.grantee}`;
  }
}

export class RevokeGrantOptionAggregatePrivileges extends AlterAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly version: number | undefined;
  public readonly scope = "privilege" as const;

  constructor(props: {
    aggregate: Aggregate;
    grantee: string;
    privilegeNames: string[];
    version?: number;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
    this.version = props.version;
  }

  get requires() {
    return [
      stableId.acl(this.aggregate.stableId, this.grantee),
      this.aggregate.stableId,
      stableId.role(this.grantee),
    ];
  }

  serialize(_options?: SerializeOptions): string {
    const kindPrefix = getObjectKindPrefix("FUNCTION");
    const privSql = formatObjectPrivilegeList(
      "FUNCTION",
      this.privilegeNames,
      this.version,
    );
    const qualified = aggregateGrantSignature(this.aggregate);
    return `REVOKE GRANT OPTION FOR ${privSql} ${kindPrefix} ${qualified} FROM ${this.grantee}`;
  }
}
