import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "./changes/rls-policy.alter.ts";
import {
  CreateCommentOnRlsPolicy,
  DropCommentOnRlsPolicy,
} from "./changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./changes/rls-policy.drop.ts";
import type { RlsPolicyChange } from "./changes/rls-policy.types.ts";
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
): RlsPolicyChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: RlsPolicyChange[] = [];

  for (const rlsPolicyId of created) {
    const policy = branch[rlsPolicyId];
    changes.push(new CreateRlsPolicy({ policy: policy }));
    if (policy.comment !== null) {
      changes.push(new CreateCommentOnRlsPolicy({ policy }));
    }
  }

  for (const rlsPolicyId of dropped) {
    changes.push(new DropRlsPolicy({ policy: main[rlsPolicyId] }));
  }

  for (const rlsPolicyId of altered) {
    const mainRlsPolicy = main[rlsPolicyId];
    const branchRlsPolicy = branch[rlsPolicyId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the RLS policy
    // These attributes require drop+create (Postgres has no ALTER for them)
    const NON_ALTERABLE_FIELDS: Array<keyof RlsPolicy> = [
      "command",
      "permissive",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainRlsPolicy,
      branchRlsPolicy,
      NON_ALTERABLE_FIELDS,
      {},
    );

    // The set of relations and procedures that the policy's USING / WITH
    // CHECK expressions reference is recorded by PostgreSQL in pg_depend
    // (recordDependencyOnExpr at policy creation). When that set changes
    // it is unsafe to ALTER POLICY in place: the old reference target may
    // be dropped in the same plan, and the new reference target may only
    // exist after the create phase. Drop+create lets the sort phase order
    // the policy's drop before the referenced object's drop and the
    // policy's recreate after the referenced object's create.
    const referencedDependenciesChanged = hasNonAlterableChanges(
      mainRlsPolicy,
      branchRlsPolicy,
      ["referenced_procedures", "referenced_relations"] as const,
      {
        referenced_procedures: deepEqual,
        referenced_relations: deepEqual,
      },
    );

    if (nonAlterablePropsChanged || referencedDependenciesChanged) {
      // Replace the entire RLS policy (drop + create)
      changes.push(
        new DropRlsPolicy({ policy: mainRlsPolicy }),
        new CreateRlsPolicy({ policy: branchRlsPolicy }),
      );
    } else {
      // Only alterable properties changed - check each one

      // ROLES (TO ...)
      const rolesEqual = deepEqual(mainRlsPolicy.roles, branchRlsPolicy.roles);
      if (!rolesEqual) {
        changes.push(
          new AlterRlsPolicySetRoles({
            policy: mainRlsPolicy,
            roles: branchRlsPolicy.roles,
          }),
        );
      }

      // USING expression
      if (mainRlsPolicy.using_expression !== branchRlsPolicy.using_expression) {
        changes.push(
          new AlterRlsPolicySetUsingExpression({
            policy: mainRlsPolicy,
            usingExpression: branchRlsPolicy.using_expression,
          }),
        );
      }

      // WITH CHECK expression
      if (
        mainRlsPolicy.with_check_expression !==
        branchRlsPolicy.with_check_expression
      ) {
        changes.push(
          new AlterRlsPolicySetWithCheckExpression({
            policy: mainRlsPolicy,
            withCheckExpression: branchRlsPolicy.with_check_expression,
          }),
        );
      }

      // COMMENT
      if (mainRlsPolicy.comment !== branchRlsPolicy.comment) {
        if (branchRlsPolicy.comment === null) {
          changes.push(new DropCommentOnRlsPolicy({ policy: mainRlsPolicy }));
        } else {
          changes.push(
            new CreateCommentOnRlsPolicy({ policy: branchRlsPolicy }),
          );
        }
      }

      // Note: RLS policy renaming would require drop+create due to identity fields
    }
  }

  return changes;
}
