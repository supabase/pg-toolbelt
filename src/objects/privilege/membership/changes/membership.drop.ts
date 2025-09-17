import { DropChange } from "../../../base.change.ts";

export class RevokeRoleMembership extends DropChange {
  public readonly role: string;
  public readonly member: string;

  constructor(props: { role: string; member: string }) {
    super();
    this.role = props.role;
    this.member = props.member;
  }

  get dependencies() {
    return [`role:${this.role}`, `role:${this.member}`];
  }

  serialize(): string {
    return `REVOKE ${this.role} FROM ${this.member}`;
  }
}
