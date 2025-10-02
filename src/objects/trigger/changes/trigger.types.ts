import type { AlterTrigger } from "./trigger.alter.ts";
import type { CommentTrigger } from "./trigger.comment.ts";
import type { CreateTrigger } from "./trigger.create.ts";
import type { DropTrigger } from "./trigger.drop.ts";

export type TriggerChange =
  | AlterTrigger
  | CommentTrigger
  | CreateTrigger
  | DropTrigger;
