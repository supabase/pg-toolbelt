import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Aggregate } from "../aggregate.model.ts";
import {
  CreateAggregateChange,
  DropAggregateChange,
} from "./aggregate.base.ts";

export type SecurityLabelAggregate =
  | CreateSecurityLabelOnAggregate
  | DropSecurityLabelOnAggregate;

function aggregateIdentity(a: Aggregate): string {
  return `${a.schema}.${a.name}(${a.identityArguments})`;
}

export class CreateSecurityLabelOnAggregate extends CreateAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    aggregate: Aggregate;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.aggregate.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.aggregate.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON AGGREGATE",
      aggregateIdentity(this.aggregate),
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnAggregate extends DropAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    aggregate: Aggregate;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.aggregate = props.aggregate;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.aggregate.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.aggregate.stableId,
        this.securityLabel.provider,
      ),
      this.aggregate.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON AGGREGATE",
      aggregateIdentity(this.aggregate),
      "IS NULL",
    ].join(" ");
  }
}
