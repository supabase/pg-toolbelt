import { CreateChange } from "../../../base.change.ts";

export class GrantRoleMembership extends CreateChange {
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
    // On creation, only emit ADMIN OPTION; leave INHERIT/SET to defaults
    const opts: string[] = [];
    if (this.options.admin) opts.push("ADMIN OPTION");
    const withClause = opts.length > 0 ? ` WITH ${opts.join(" ")}` : "";
    return `GRANT ${this.role} TO ${this.member}${withClause}`;
  }
}
