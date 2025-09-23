import { Change, type ChangeObjectType } from "../../../base.change.ts";

export class GrantObjectPrivileges extends Change {
  public readonly objectId: string;
  public readonly objectNameSql: string;
  public readonly objectKind: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly operation = "create" as const;
  public readonly scope = "privilege" as const;
  public get objectType(): ChangeObjectType {
    switch (this.objectKind) {
      case "ROUTINE":
        return "procedure";
      case "LANGUAGE":
        return "language";
      case "SCHEMA":
        return "schema";
      case "SEQUENCE":
        return "sequence";
      case "DOMAIN":
        return "domain";
      case "TYPE":
        return "composite_type";
      case "TABLE":
        return "table";
      case "VIEW":
        return "view";
      case "MATERIALIZED VIEW":
        return "materialized_view";
      default:
        throw new Error(`Unknown object kind: ${this.objectKind}`);
    }
  }

  constructor(props: {
    objectId: string;
    objectNameSql: string;
    objectKind: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
  }) {
    super();
    this.objectId = props.objectId;
    this.objectNameSql = props.objectNameSql;
    this.objectKind = props.objectKind;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
  }

  get dependencies() {
    const aclStableId = `acl:${this.objectId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const privGroups = new Map<boolean, string[]>();
    for (const p of this.privileges) {
      if (!privGroups.has(p.grantable)) privGroups.set(p.grantable, []);
      const arr = privGroups.get(p.grantable);
      if (arr) arr.push(p.privilege);
    }
    const stmts: string[] = [];
    for (const [grantable, list] of privGroups) {
      const withGrant = grantable ? " WITH GRANT OPTION" : "";
      const kindPrefix =
        this.objectKind === "ROUTINE"
          ? "ON ROUTINE"
          : this.objectKind === "LANGUAGE"
            ? "ON LANGUAGE"
            : this.objectKind === "SCHEMA"
              ? "ON SCHEMA"
              : this.objectKind === "SEQUENCE"
                ? "ON SEQUENCE"
                : this.objectKind === "DOMAIN"
                  ? "ON DOMAIN"
                  : this.objectKind === "TYPE"
                    ? "ON TYPE"
                    : "ON";
      stmts.push(
        `GRANT ${[...new Set(list)].sort().join(", ")} ${kindPrefix} ${this.objectNameSql} TO ${this.grantee}${withGrant}`,
      );
    }
    return stmts.join("; ");
  }
}

export class RevokeObjectPrivileges extends Change {
  public readonly objectId: string;
  public readonly objectNameSql: string;
  public readonly objectKind: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public get objectType(): ChangeObjectType {
    switch (this.objectKind) {
      case "ROUTINE":
        return "procedure";
      case "LANGUAGE":
        return "language";
      case "SCHEMA":
        return "schema";
      case "SEQUENCE":
        return "sequence";
      case "DOMAIN":
        return "domain";
      case "TYPE":
        return "composite_type";
      case "TABLE":
        return "table";
      case "VIEW":
        return "view";
      case "MATERIALIZED VIEW":
        return "materialized_view";
      default:
        throw new Error(`Unknown object kind: ${this.objectKind}`);
    }
  }

  constructor(props: {
    objectId: string;
    objectNameSql: string;
    objectKind: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
  }) {
    super();
    this.objectId = props.objectId;
    this.objectNameSql = props.objectNameSql;
    this.objectKind = props.objectKind;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
  }

  get dependencies() {
    const aclStableId = `acl:${this.objectId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const privGroups = new Map<boolean, string[]>();
    for (const p of this.privileges) {
      if (!privGroups.has(p.grantable)) privGroups.set(p.grantable, []);
      const arr = privGroups.get(p.grantable);
      if (arr) arr.push(p.privilege);
    }
    const stmts: string[] = [];
    for (const [_grantable, list] of privGroups) {
      const kindPrefix =
        this.objectKind === "ROUTINE"
          ? "ON ROUTINE"
          : this.objectKind === "LANGUAGE"
            ? "ON LANGUAGE"
            : this.objectKind === "SCHEMA"
              ? "ON SCHEMA"
              : this.objectKind === "SEQUENCE"
                ? "ON SEQUENCE"
                : this.objectKind === "DOMAIN"
                  ? "ON DOMAIN"
                  : this.objectKind === "TYPE"
                    ? "ON TYPE"
                    : "ON";
      void _grantable;
      stmts.push(
        `REVOKE ${[...new Set(list)].sort().join(", ")} ${kindPrefix} ${this.objectNameSql} FROM ${this.grantee}`,
      );
    }
    return stmts.join("; ");
  }
}

export class RevokeGrantOptionObjectPrivileges extends Change {
  public readonly objectId: string;
  public readonly objectNameSql: string;
  public readonly objectKind: string;
  public readonly grantee: string;
  public readonly privilegeNames: string[];
  public readonly operation = "drop" as const;
  public readonly scope = "privilege" as const;
  public get objectType(): ChangeObjectType {
    switch (this.objectKind) {
      case "ROUTINE":
        return "procedure";
      case "LANGUAGE":
        return "language";
      case "SCHEMA":
        return "schema";
      case "SEQUENCE":
        return "sequence";
      case "DOMAIN":
        return "domain";
      case "TYPE":
        return "composite_type";
      case "TABLE":
        return "table";
      case "VIEW":
        return "view";
      case "MATERIALIZED VIEW":
        return "materialized_view";
      default:
        throw new Error(`Unknown object kind: ${this.objectKind}`);
    }
  }

  constructor(props: {
    objectId: string;
    objectNameSql: string;
    objectKind: string;
    grantee: string;
    privilegeNames: string[];
  }) {
    super();
    this.objectId = props.objectId;
    this.objectNameSql = props.objectNameSql;
    this.objectKind = props.objectKind;
    this.grantee = props.grantee;
    this.privilegeNames = [...new Set(props.privilegeNames)].sort();
  }

  get dependencies() {
    const aclStableId = `acl:${this.objectId}::grantee:${this.grantee}`;
    return [aclStableId];
  }

  serialize(): string {
    const kindPrefix =
      this.objectKind === "ROUTINE"
        ? "ON ROUTINE"
        : this.objectKind === "LANGUAGE"
          ? "ON LANGUAGE"
          : this.objectKind === "SCHEMA"
            ? "ON SCHEMA"
            : this.objectKind === "SEQUENCE"
              ? "ON SEQUENCE"
              : this.objectKind === "DOMAIN"
                ? "ON DOMAIN"
                : this.objectKind === "TYPE"
                  ? "ON TYPE"
                  : "ON";
    return `REVOKE GRANT OPTION FOR ${this.privilegeNames.join(", ")} ${kindPrefix} ${this.objectNameSql} FROM ${this.grantee}`;
  }
}
