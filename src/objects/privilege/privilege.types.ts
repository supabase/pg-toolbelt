import type { ColumnPrivilegeChange } from "./column-privilege/changes/column-privilege.types.ts";
import type { DefaultPrivilegeChange } from "./default-privilege/changes/default-privilege.types.ts";
import type { MembershipChange } from "./membership/changes/membership.types.ts";
import type { ObjectPrivilegeChange } from "./object-privilege/changes/object-privilege.types.ts";

export type PrivilegeChange =
  | ColumnPrivilegeChange
  | DefaultPrivilegeChange
  | MembershipChange
  | ObjectPrivilegeChange;
