import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { View } from "../view.model.ts";
import { CreateViewChange, DropViewChange } from "./view.base.ts";

export type SecurityLabelView =
  | CreateSecurityLabelOnView
  | DropSecurityLabelOnView;

export class CreateSecurityLabelOnView extends CreateViewChange {
  public readonly view: View;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { view: View; securityLabel: SecurityLabelProps }) {
    super();
    this.view = props.view;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.view.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.view.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnView extends DropViewChange {
  public readonly view: View;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { view: View; securityLabel: SecurityLabelProps }) {
    super();
    this.view = props.view;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.view.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.view.stableId, this.securityLabel.provider),
      this.view.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS NULL",
    ].join(" ");
  }
}
