import type { AlterView } from "./view.alter.ts";
import type { CommentView } from "./view.comment.ts";
import type { CreateView } from "./view.create.ts";
import type { DropView } from "./view.drop.ts";
import type { ViewPrivilege } from "./view.privilege.ts";

/** Union of all view-related change variants (`objectType: "view"`). @category Change Types */
export type ViewChange =
  | AlterView
  | CommentView
  | CreateView
  | DropView
  | ViewPrivilege;
