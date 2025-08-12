import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterRlsPolicyChangeOwner,
  ReplaceRlsPolicy,
} from "./changes/rls-policy.alter.ts";
import { CreateRlsPolicy } from "./changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./changes/rls-policy.drop.ts";
import type { RlsPolicy } from "./rls-policy.model.ts";

/**
 * Diff two sets of RLS policies from main and branch catalogs.
 *
 * @param main - The RLS policies in the main catalog.
 * @param branch - The RLS policies in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffRlsPolicies(
  main: Record<string, RlsPolicy>,
  branch: Record<string, RlsPolicy>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const rlsPolicyId of created) {
    changes.push(new CreateRlsPolicy({ rlsPolicy: branch[rlsPolicyId] }));
  }

  for (const rlsPolicyId of dropped) {
    changes.push(new DropRlsPolicy({ rlsPolicy: main[rlsPolicyId] }));
  }

  for (const rlsPolicyId of altered) {
    const mainRlsPolicy = main[rlsPolicyId];
    const branchRlsPolicy = branch[rlsPolicyId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the RLS policy
    const NON_ALTERABLE_FIELDS: Array<keyof RlsPolicy> = [
      "command",
      "permissive",
      "roles",
      "using_expression",
      "with_check_expression",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainRlsPolicy,
      branchRlsPolicy,
      NON_ALTERABLE_FIELDS,
      { roles: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire RLS policy (drop + create)
      changes.push(
        new ReplaceRlsPolicy({ main: mainRlsPolicy, branch: branchRlsPolicy }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainRlsPolicy.owner !== branchRlsPolicy.owner) {
        changes.push(
          new AlterRlsPolicyChangeOwner({
            main: mainRlsPolicy,
            branch: branchRlsPolicy,
          }),
        );
      }

      // Note: RLS policy renaming would also use ALTER POLICY ... RENAME TO ...
      // But since our RlsPolicy model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
