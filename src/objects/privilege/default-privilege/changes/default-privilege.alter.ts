import { AlterChange } from "../../../base.change.ts";

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

export class AlterDefaultPrivilegesGrant extends AlterChange {
  public readonly grantor: string;
  public readonly inSchema: string | null;
  public readonly objtype: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];

  constructor(props: {
    grantor: string;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
  }) {
    super();
    this.grantor = props.grantor;
    this.inSchema = props.inSchema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
  }

  get dependencies() {
    const deps = [`role:${this.grantor}`, `role:${this.grantee}`];
    if (this.inSchema) deps.push(`schema:${this.inSchema}`);
    const scope = this.inSchema ? `schema:${this.inSchema}` : "global";
    const defaclStableId = `defacl:${this.grantor}:${this.objtype}:${scope}:grantee:${this.grantee}`;
    // Ensure the defacl object is also part of dependency set
    deps.push(defaclStableId);
    return deps;
  }

  serialize(): string {
    const scope = this.inSchema ? ` IN SCHEMA ${this.inSchema}` : "";
    const groups = new Map<boolean, string[]>();
    for (const p of this.privileges) {
      if (!groups.has(p.grantable)) groups.set(p.grantable, []);
      const arr = groups.get(p.grantable);
      if (arr) arr.push(p.privilege);
    }
    const stmts: string[] = [];
    for (const [grantable, list] of groups) {
      const withGrant = grantable ? " WITH GRANT OPTION" : "";
      stmts.push(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${this.grantor}${scope} GRANT ${[...new Set(list)].sort().join(", ")} ON ${objtypeToKeyword(this.objtype)} TO ${this.grantee}${withGrant}`,
      );
    }
    return stmts.join("; ");
  }
}

export class AlterDefaultPrivilegesRevoke extends AlterChange {
  public readonly grantor: string;
  public readonly inSchema: string | null;
  public readonly objtype: string;
  public readonly grantee: string;
  public readonly privileges: { privilege: string; grantable: boolean }[];

  constructor(props: {
    grantor: string;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    privileges: { privilege: string; grantable: boolean }[];
  }) {
    super();
    this.grantor = props.grantor;
    this.inSchema = props.inSchema;
    this.objtype = props.objtype;
    this.grantee = props.grantee;
    this.privileges = props.privileges;
  }

  get dependencies() {
    const deps = [`role:${this.grantor}`, `role:${this.grantee}`];
    if (this.inSchema) deps.push(`schema:${this.inSchema}`);
    const scope = this.inSchema ? `schema:${this.inSchema}` : "global";
    const defaclStableId = `defacl:${this.grantor}:${this.objtype}:${scope}:grantee:${this.grantee}`;
    deps.push(defaclStableId);
    return deps;
  }

  serialize(): string {
    const scope = this.inSchema ? ` IN SCHEMA ${this.inSchema}` : "";
    const stmts: string[] = [];
    const grantOptionPrivs = this.privileges
      .filter((p) => p.grantable)
      .map((p) => p.privilege);
    const basePrivs = this.privileges
      .filter((p) => !p.grantable)
      .map((p) => p.privilege);

    if (grantOptionPrivs.length > 0) {
      const uniq = [...new Set(grantOptionPrivs)].sort();
      stmts.push(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${this.grantor}${scope} REVOKE GRANT OPTION FOR ${uniq.join(", ")} ON ${objtypeToKeyword(this.objtype)} FROM ${this.grantee}`,
      );
    }
    if (basePrivs.length > 0) {
      const uniq = [...new Set(basePrivs)].sort();
      stmts.push(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${this.grantor}${scope} REVOKE ${uniq.join(", ")} ON ${objtypeToKeyword(this.objtype)} FROM ${this.grantee}`,
      );
    }
    return stmts.join("; ");
  }
}
