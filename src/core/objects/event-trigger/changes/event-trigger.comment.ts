import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { EventTrigger } from "../event-trigger.model.ts";
import {
  CreateEventTriggerChange,
  DropEventTriggerChange,
} from "./event-trigger.base.ts";

export type CommentEventTrigger =
  | CreateCommentOnEventTrigger
  | DropCommentOnEventTrigger;

export class CreateCommentOnEventTrigger extends CreateEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly scope = "comment" as const;

  constructor(props: { eventTrigger: EventTrigger }) {
    super();
    this.eventTrigger = props.eventTrigger;
  }

  get creates() {
    return [stableId.comment(this.eventTrigger.stableId)];
  }

  get requires() {
    return [this.eventTrigger.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON EVENT TRIGGER"),
      this.eventTrigger.name,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: comment creation implies non-null
      quoteLiteral(this.eventTrigger.comment!),
    );
  }
}

export class DropCommentOnEventTrigger extends DropEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly scope = "comment" as const;

  constructor(props: { eventTrigger: EventTrigger }) {
    super();
    this.eventTrigger = props.eventTrigger;
  }

  get drops() {
    return [stableId.comment(this.eventTrigger.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.eventTrigger.stableId),
      this.eventTrigger.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON EVENT TRIGGER"),
      this.eventTrigger.name,
      ctx.keyword("IS NULL"),
    );
  }
}
