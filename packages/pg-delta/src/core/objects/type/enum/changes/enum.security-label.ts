import { quoteLiteral } from "../../../base.change.ts";
import type { SecurityLabelProps } from "../../../security-label.types.ts";
import { stableId } from "../../../utils.ts";
import type { Enum } from "../enum.model.ts";
import { CreateEnumChange, DropEnumChange } from "./enum.base.ts";

export type SecurityLabelEnum =
  | CreateSecurityLabelOnEnum
  | DropSecurityLabelOnEnum;

export class CreateSecurityLabelOnEnum extends CreateEnumChange {
  public readonly enum: Enum;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { enum: Enum; securityLabel: SecurityLabelProps }) {
    super();
    this.enum = props.enum;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.enum.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.enum.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnEnum extends DropEnumChange {
  public readonly enum: Enum;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { enum: Enum; securityLabel: SecurityLabelProps }) {
    super();
    this.enum = props.enum;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.enum.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.enum.stableId, this.securityLabel.provider),
      this.enum.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "IS NULL",
    ].join(" ");
  }
}
