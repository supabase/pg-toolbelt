import type { AlterEventTrigger } from "./event-trigger.alter.ts";
import type { CommentEventTrigger } from "./event-trigger.comment.ts";
import type { CreateEventTrigger } from "./event-trigger.create.ts";
import type { DropEventTrigger } from "./event-trigger.drop.ts";

/** Union of all event-trigger-related change variants (`objectType: "event_trigger"`). @category Change Types */
export type EventTriggerChange =
  | AlterEventTrigger
  | CommentEventTrigger
  | CreateEventTrigger
  | DropEventTrigger;
