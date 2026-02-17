import type { AlterIndex } from "./index.alter.ts";
import type { CommentIndex } from "./index.comment.ts";
import type { CreateIndex } from "./index.create.ts";
import type { DropIndex } from "./index.drop.ts";

export type IndexChange = AlterIndex | CommentIndex | CreateIndex | DropIndex;
