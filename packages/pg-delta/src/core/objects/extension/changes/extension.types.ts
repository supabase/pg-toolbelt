import type { AlterExtension } from "./extension.alter.ts";
import type { CommentExtension } from "./extension.comment.ts";
import type { CreateExtension } from "./extension.create.ts";
import type { DropExtension } from "./extension.drop.ts";

/** Union of all extension-related change variants (`objectType: "extension"`). @category Change Types */
export type ExtensionChange =
  | AlterExtension
  | CommentExtension
  | CreateExtension
  | DropExtension;
