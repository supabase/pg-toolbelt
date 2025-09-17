import { AlterChange } from "../../../base.change.ts";

export class UpdateRoleMembership extends AlterChange {
  public readonly role: string;
  public readonly member: string;
  public readonly options: {
    admin: boolean;
    inherit?: boolean | null;
    set?: boolean | null;
  };

  constructor(props: {
    role: string;
    member: string;
    options: { admin: boolean; inherit?: boolean | null; set?: boolean | null };
  }) {
    super();
    this.role = props.role;
    this.member = props.member;
    this.options = props.options;
  }

  get dependencies() {
    return [`role:${this.role}`, `role:${this.member}`];
  }

  serialize(): string {
    const opts: string[] = [];
    if (this.options.admin) opts.push("ADMIN OPTION");
    if (this.options.inherit === true) opts.push("INHERIT OPTION");
    if (this.options.set === true) opts.push("SET OPTION");
    const withClause = opts.length > 0 ? ` WITH ${opts.join(" ")}` : "";
    return `GRANT ${this.role} TO ${this.member}${withClause}`;
  }
}
