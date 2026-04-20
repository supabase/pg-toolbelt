import { quoteLiteral } from "../../../base.change.ts";
import type { SecurityLabelProps } from "../../../security-label.types.ts";
import { stableId } from "../../../utils.ts";
import type { CompositeType } from "../composite-type.model.ts";
import {
  CreateCompositeTypeChange,
  DropCompositeTypeChange,
} from "./composite-type.base.ts";

export type SecurityLabelCompositeType =
  | CreateSecurityLabelOnCompositeType
  | DropSecurityLabelOnCompositeType;

export class CreateSecurityLabelOnCompositeType extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    compositeType: CompositeType;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.compositeType = props.compositeType;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.compositeType.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.compositeType.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnCompositeType extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    compositeType: CompositeType;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.compositeType = props.compositeType;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.compositeType.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.compositeType.stableId,
        this.securityLabel.provider,
      ),
      this.compositeType.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "IS NULL",
    ].join(" ");
  }
}
