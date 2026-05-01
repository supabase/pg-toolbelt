import type { AlterRole } from "./role.alter.ts";
import type { CommentRole } from "./role.comment.ts";
import type { CreateRole } from "./role.create.ts";
import type { DropRole } from "./role.drop.ts";
import type { RolePrivilege } from "./role.privilege.ts";
import type { SecurityLabelRole } from "./role.security-label.ts";

/** Union of all role-related change variants (`objectType: "role"`). @category Change Types */
export type RoleChange =
  | AlterRole
  | CommentRole
  | CreateRole
  | DropRole
  | RolePrivilege
  | SecurityLabelRole;
