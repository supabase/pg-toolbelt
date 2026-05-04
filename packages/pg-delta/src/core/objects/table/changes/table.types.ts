import type { AlterTable } from "./table.alter.ts";
import type { CommentTable } from "./table.comment.ts";
import type { CreateTable } from "./table.create.ts";
import type { DropTable } from "./table.drop.ts";
import type { TablePrivilege } from "./table.privilege.ts";
import type { SecurityLabelTable } from "./table.security-label.ts";

/** Union of all table-related change variants (`objectType: "table"`). @category Change Types */
export type TableChange =
  | AlterTable
  | CommentTable
  | CreateTable
  | DropTable
  | TablePrivilege
  | SecurityLabelTable;
