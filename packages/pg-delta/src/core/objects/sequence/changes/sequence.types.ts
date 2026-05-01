import type { AlterSequence } from "./sequence.alter.ts";
import type { CommentSequence } from "./sequence.comment.ts";
import type { CreateSequence } from "./sequence.create.ts";
import type { DropSequence } from "./sequence.drop.ts";
import type { SequencePrivilege } from "./sequence.privilege.ts";
import type { SecurityLabelSequence } from "./sequence.security-label.ts";

/** Union of all sequence-related change variants (`objectType: "sequence"`). @category Change Types */
export type SequenceChange =
  | AlterSequence
  | CommentSequence
  | CreateSequence
  | DropSequence
  | SequencePrivilege
  | SecurityLabelSequence;
