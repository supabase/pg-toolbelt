import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Sequence } from "../sequence.model.ts";
import { CreateSequenceChange, DropSequenceChange } from "./sequence.base.ts";

export type SecurityLabelSequence =
  | CreateSecurityLabelOnSequence
  | DropSecurityLabelOnSequence;

export class CreateSecurityLabelOnSequence extends CreateSequenceChange {
  public readonly sequence: Sequence;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { sequence: Sequence; securityLabel: SecurityLabelProps }) {
    super();
    this.sequence = props.sequence;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.sequence.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.sequence.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnSequence extends DropSequenceChange {
  public readonly sequence: Sequence;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { sequence: Sequence; securityLabel: SecurityLabelProps }) {
    super();
    this.sequence = props.sequence;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.sequence.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.sequence.stableId,
        this.securityLabel.provider,
      ),
      this.sequence.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
      "IS NULL",
    ].join(" ");
  }
}
