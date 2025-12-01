import type { AlterTable } from "./table.alter.ts";
import type { CommentTable } from "./table.comment.ts";
import type { CreateTable } from "./table.create.ts";
import type { DropTable } from "./table.drop.ts";
import type { TablePrivilege } from "./table.privilege.ts";

export type TableChange =
  | AlterTable
  | CommentTable
  | CreateTable
  | DropTable
  | TablePrivilege;
