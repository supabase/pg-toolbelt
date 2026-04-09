import type { AlterEnum } from "./enum.alter.ts";
import type { CommentEnum } from "./enum.comment.ts";
import type { CreateEnum } from "./enum.create.ts";
import type { DropEnum } from "./enum.drop.ts";
import type { EnumPrivilege } from "./enum.privilege.ts";

/** Union of all enum-related change variants (`objectType: "enum"`). @category Change Types */
export type EnumChange =
  | AlterEnum
  | CommentEnum
  | CreateEnum
  | DropEnum
  | EnumPrivilege;
