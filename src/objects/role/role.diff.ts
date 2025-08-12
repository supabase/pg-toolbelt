import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import { ReplaceRole } from "./changes/role.alter.ts";
import { CreateRole } from "./changes/role.create.ts";
import { DropRole } from "./changes/role.drop.ts";
import type { Role } from "./role.model.ts";

/**
 * Diff two sets of roles from main and branch catalogs.
 *
 * @param main - The roles in the main catalog.
 * @param branch - The roles in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRoles(
  main: Record<string, Role>,
  branch: Record<string, Role>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const roleId of created) {
    changes.push(new CreateRole({ role: branch[roleId] }));
  }

  for (const roleId of dropped) {
    changes.push(new DropRole({ role: main[roleId] }));
  }

  for (const roleId of altered) {
    const mainRole = main[roleId];
    const branchRole = branch[roleId];

    // All role properties require dropping and recreating the role
    const NON_ALTERABLE_FIELDS: Array<keyof Role> = [
      "is_superuser",
      "can_inherit",
      "can_create_roles",
      "can_create_databases",
      "can_login",
      "can_replicate",
      "connection_limit",
      "can_bypass_rls",
      "config",
    ];
    const shouldReplace = hasNonAlterableChanges(
      mainRole,
      branchRole,
      NON_ALTERABLE_FIELDS,
    );
    if (shouldReplace) {
      changes.push(new ReplaceRole({ main: mainRole, branch: branchRole }));
    }
  }

  return changes;
}
