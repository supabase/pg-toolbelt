import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { EventTrigger } from "../event-trigger.model.ts";
import {
  CreateEventTriggerChange,
  DropEventTriggerChange,
} from "./event-trigger.base.ts";

export type SecurityLabelEventTrigger =
  | CreateSecurityLabelOnEventTrigger
  | DropSecurityLabelOnEventTrigger;

export class CreateSecurityLabelOnEventTrigger extends CreateEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    eventTrigger: EventTrigger;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.eventTrigger = props.eventTrigger;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.eventTrigger.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.eventTrigger.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON EVENT TRIGGER",
      this.eventTrigger.name,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnEventTrigger extends DropEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    eventTrigger: EventTrigger;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.eventTrigger = props.eventTrigger;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.eventTrigger.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.eventTrigger.stableId,
        this.securityLabel.provider,
      ),
      this.eventTrigger.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON EVENT TRIGGER",
      this.eventTrigger.name,
      "IS NULL",
    ].join(" ");
  }
}
