import type { AlterEnum } from "./enum.alter.ts";
import type { CommentEnum } from "./enum.comment.ts";
import type { CreateEnum } from "./enum.create.ts";
import type { DropEnum } from "./enum.drop.ts";
import type { EnumPrivilege } from "./enum.privilege.ts";

export type EnumChange =
  | AlterEnum
  | CommentEnum
  | CreateEnum
  | DropEnum
  | EnumPrivilege;
