import type { AlterTrigger } from "./trigger.alter.ts";
import type { CommentTrigger } from "./trigger.comment.ts";
import type { CreateTrigger } from "./trigger.create.ts";
import type { DropTrigger } from "./trigger.drop.ts";

/** Union of all trigger-related change variants (`objectType: "trigger"`). @category Change Types */
export type TriggerChange =
  | AlterTrigger
  | CommentTrigger
  | CreateTrigger
  | DropTrigger;
