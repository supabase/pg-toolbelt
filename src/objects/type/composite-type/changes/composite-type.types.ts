import type { AlterCompositeType } from "./composite-type.alter.ts";
import type { CommentCompositeType } from "./composite-type.comment.ts";
import type { CreateCompositeType } from "./composite-type.create.ts";
import type { DropCompositeType } from "./composite-type.drop.ts";
import type { CompositeTypePrivilege } from "./composite-type.privilege.ts";

export type CompositeTypeChange =
  | AlterCompositeType
  | CommentCompositeType
  | CreateCompositeType
  | DropCompositeType
  | CompositeTypePrivilege;
