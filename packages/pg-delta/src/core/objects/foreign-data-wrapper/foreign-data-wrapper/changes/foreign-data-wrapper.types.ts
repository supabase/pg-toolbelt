import type { AlterForeignDataWrapper } from "./foreign-data-wrapper.alter.ts";
import type { CommentForeignDataWrapper } from "./foreign-data-wrapper.comment.ts";
import type { CreateForeignDataWrapper } from "./foreign-data-wrapper.create.ts";
import type { DropForeignDataWrapper } from "./foreign-data-wrapper.drop.ts";
import type { ForeignDataWrapperPrivilege } from "./foreign-data-wrapper.privilege.ts";

/** Union of all FDW wrapper-level change variants (`objectType: "foreign_data_wrapper"`). @category Change Types */
export type ForeignDataWrapperChange =
  | AlterForeignDataWrapper
  | CommentForeignDataWrapper
  | CreateForeignDataWrapper
  | DropForeignDataWrapper
  | ForeignDataWrapperPrivilege;
