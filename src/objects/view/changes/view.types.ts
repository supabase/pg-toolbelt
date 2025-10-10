import type { AlterView } from "./view.alter.ts";
import type { CommentView } from "./view.comment.ts";
import type { CreateView } from "./view.create.ts";
import type { DropView } from "./view.drop.ts";
import type { ViewPrivilege } from "./view.privilege.ts";

export type ViewChange =
  | AlterView
  | CommentView
  | CreateView
  | DropView
  | ViewPrivilege;
