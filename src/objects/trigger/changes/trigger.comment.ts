import { quoteLiteral } from "../../base.change.ts";
import type { Trigger } from "../trigger.model.ts";
import { CreateTriggerChange, DropTriggerChange } from "./trigger.base.ts";

export type CommentTrigger = CreateCommentOnTrigger | DropCommentOnTrigger;

export class CreateCommentOnTrigger extends CreateTriggerChange {
  public readonly trigger: Trigger;
  public readonly scope = "comment" as const;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  get dependencies() {
    return [
      `comment:${this.trigger.schema}.${this.trigger.table_name}.${this.trigger.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON TRIGGER",
      this.trigger.name,
      "ON",
      `${this.trigger.schema}.${this.trigger.table_name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: trigger comment is not nullable in this case
      quoteLiteral(this.trigger.comment!),
    ].join(" ");
  }
}

export class DropCommentOnTrigger extends DropTriggerChange {
  public readonly trigger: Trigger;
  public readonly scope = "comment" as const;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  get dependencies() {
    return [
      `comment:${this.trigger.schema}.${this.trigger.table_name}.${this.trigger.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON TRIGGER",
      this.trigger.name,
      "ON",
      `${this.trigger.schema}.${this.trigger.table_name}`,
      "IS NULL",
    ].join(" ");
  }
}
