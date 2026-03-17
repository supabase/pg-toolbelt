/**
 * Type guards for narrowing the Change discriminated union.
 */

import type { Change } from "./change.types.ts";

/**
 * A Change that represents a default privilege operation on a role.
 * These changes always have `inSchema`, `objtype`, and `grantee` properties.
 */
type RoleDefaultPrivilegeChange = Change & {
  objectType: "role";
  scope: "default_privilege";
  inSchema: string | null;
  objtype: string;
  grantee: string;
};

export function isRoleDefaultPrivilegeChange(
  change: Change,
): change is RoleDefaultPrivilegeChange {
  return (
    change.objectType === "role" &&
    change.scope === "default_privilege" &&
    "inSchema" in change
  );
}
