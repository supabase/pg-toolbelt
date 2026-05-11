import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Role } from "../role.model.ts";
import { CreateRoleChange, DropRoleChange } from "./role.base.ts";

export type SecurityLabelRole =
  | CreateSecurityLabelOnRole
  | DropSecurityLabelOnRole;

export class CreateSecurityLabelOnRole extends CreateRoleChange {
  public readonly role: Role;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { role: Role; securityLabel: SecurityLabelProps }) {
    super();
    this.role = props.role;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.role.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.role.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON ROLE",
      this.role.name,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnRole extends DropRoleChange {
  public readonly role: Role;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { role: Role; securityLabel: SecurityLabelProps }) {
    super();
    this.role = props.role;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.role.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.role.stableId, this.securityLabel.provider),
      this.role.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON ROLE",
      this.role.name,
      "IS NULL",
    ].join(" ");
  }
}
