import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import {
  CreateSubscriptionChange,
  DropSubscriptionChange,
} from "./subscription.base.ts";

export type SecurityLabelSubscription =
  | CreateSecurityLabelOnSubscription
  | DropSecurityLabelOnSubscription;

export class CreateSecurityLabelOnSubscription extends CreateSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    subscription: Subscription;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.subscription = props.subscription;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.subscription.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.subscription.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON SUBSCRIPTION",
      this.subscription.name,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnSubscription extends DropSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    subscription: Subscription;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.subscription = props.subscription;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.subscription.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.subscription.stableId,
        this.securityLabel.provider,
      ),
      this.subscription.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON SUBSCRIPTION",
      this.subscription.name,
      "IS NULL",
    ].join(" ");
  }
}
