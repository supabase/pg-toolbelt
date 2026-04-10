import type { AlterCollation } from "./collation.alter.ts";
import type { CommentCollation } from "./collation.comment.ts";
import type { CreateCollation } from "./collation.create.ts";
import type { DropCollation } from "./collation.drop.ts";

/** Union of all collation-related change variants (`objectType: "collation"`). @category Change Types */
export type CollationChange =
  | AlterCollation
  | CommentCollation
  | CreateCollation
  | DropCollation;
