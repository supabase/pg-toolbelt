import type { AlterCompositeType } from "./composite-type.alter.ts";
import type { CommentCompositeType } from "./composite-type.comment.ts";
import type { CreateCompositeType } from "./composite-type.create.ts";
import type { DropCompositeType } from "./composite-type.drop.ts";
import type { CompositeTypePrivilege } from "./composite-type.privilege.ts";

/** Union of all composite-type-related change variants (`objectType: "composite_type"`). @category Change Types */
export type CompositeTypeChange =
  | AlterCompositeType
  | CommentCompositeType
  | CreateCompositeType
  | DropCompositeType
  | CompositeTypePrivilege;
