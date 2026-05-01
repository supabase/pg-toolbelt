import { quoteLiteral } from "../../../base.change.ts";
import type { SecurityLabelProps } from "../../../security-label.types.ts";
import { stableId } from "../../../utils.ts";
import type { Range } from "../range.model.ts";
import { CreateRangeChange, DropRangeChange } from "./range.base.ts";

export type SecurityLabelRange =
  | CreateSecurityLabelOnRange
  | DropSecurityLabelOnRange;

export class CreateSecurityLabelOnRange extends CreateRangeChange {
  public readonly range: Range;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { range: Range; securityLabel: SecurityLabelProps }) {
    super();
    this.range = props.range;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.range.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.range.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TYPE",
      `${this.range.schema}.${this.range.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnRange extends DropRangeChange {
  public readonly range: Range;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { range: Range; securityLabel: SecurityLabelProps }) {
    super();
    this.range = props.range;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.range.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.range.stableId, this.securityLabel.provider),
      this.range.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TYPE",
      `${this.range.schema}.${this.range.name}`,
      "IS NULL",
    ].join(" ");
  }
}
