import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Role } from "../role.model.ts";

export class CreateCommentOnRole extends CreateChange {
  public readonly role: Role;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get dependencies() {
    return [`comment:${this.role.role_name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON ROLE",
      this.role.role_name,
      "IS",
      quoteLiteral(this.role.comment as string),
    ].join(" ");
  }
}

export class DropCommentOnRole extends DropChange {
  public readonly role: Role;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get dependencies() {
    return [`comment:${this.role.role_name}`];
  }

  serialize(): string {
    return ["COMMENT ON ROLE", this.role.role_name, "IS NULL"].join(" ");
  }
}
