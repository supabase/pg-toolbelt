import type { AlterForeignTable } from "./foreign-table.alter.ts";
import type { CommentForeignTable } from "./foreign-table.comment.ts";
import type { CreateForeignTable } from "./foreign-table.create.ts";
import type { DropForeignTable } from "./foreign-table.drop.ts";
import type { ForeignTablePrivilege } from "./foreign-table.privilege.ts";
import type { SecurityLabelForeignTable } from "./foreign-table.security-label.ts";

/** Union of all foreign-table-related change variants (`objectType: "foreign_table"`). @category Change Types */
export type ForeignTableChange =
  | AlterForeignTable
  | CommentForeignTable
  | CreateForeignTable
  | DropForeignTable
  | ForeignTablePrivilege
  | SecurityLabelForeignTable;
