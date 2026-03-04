import type { DefaultPrivilegeState } from "./base.default-privileges.ts";
import type { Role } from "./role/role.model.ts";

/**
 * Unified context built by `diffCatalogs` and passed to per-object diff
 * functions.  Each diff declares only the keys it reads via
 * `Pick<ObjectDiffContext, …>`, so every signature documents its actual
 * requirements.  The full object is always assignable to every narrower Pick.
 */
export interface ObjectDiffContext {
  version: number;
  currentUser: string;
  defaultPrivilegeState: DefaultPrivilegeState;
  mainRoles: Record<string, Role>;
  skipDefaultPrivilegeSubtraction?: boolean;
}
