import type { AlterCollation } from "./collation.alter.ts";
import type { CommentCollation } from "./collation.comment.ts";
import type { CreateCollation } from "./collation.create.ts";
import type { DropCollation } from "./collation.drop.ts";

export type CollationChange =
  | AlterCollation
  | CommentCollation
  | CreateCollation
  | DropCollation;
