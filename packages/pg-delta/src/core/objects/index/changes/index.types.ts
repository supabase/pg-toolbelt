import type { AlterIndex } from "./index.alter.ts";
import type { CommentIndex } from "./index.comment.ts";
import type { CreateIndex } from "./index.create.ts";
import type { DropIndex } from "./index.drop.ts";

/** Union of all index-related change variants (`objectType: "index"`). @category Change Types */
export type IndexChange = AlterIndex | CommentIndex | CreateIndex | DropIndex;
