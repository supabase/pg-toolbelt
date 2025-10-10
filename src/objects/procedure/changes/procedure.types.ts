import type { AlterProcedure } from "./procedure.alter.ts";
import type { CommentProcedure } from "./procedure.comment.ts";
import type { CreateProcedure } from "./procedure.create.ts";
import type { DropProcedure } from "./procedure.drop.ts";
import type { ProcedurePrivilege } from "./procedure.privilege.ts";

export type ProcedureChange =
  | AlterProcedure
  | CommentProcedure
  | CreateProcedure
  | DropProcedure
  | ProcedurePrivilege;
