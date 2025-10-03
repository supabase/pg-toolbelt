import type { DefaultPrivilegeChange } from "./default-privilege/changes/default-privilege.types.ts";
import type { MembershipChange } from "./membership/changes/membership.types.ts";

export type PrivilegeChange = DefaultPrivilegeChange | MembershipChange;
