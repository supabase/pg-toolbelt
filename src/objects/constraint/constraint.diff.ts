import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { ReplaceConstraint } from "./changes/constraint.alter.ts";
import { CreateConstraint } from "./changes/constraint.create.ts";
import { DropConstraint } from "./changes/constraint.drop.ts";
import type { Constraint } from "./constraint.model.ts";

/**
 * Diff two sets of constraints from main and branch catalogs.
 *
 * @param main - The constraints in the main catalog.
 * @param branch - The constraints in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffConstraints(
  main: Record<string, Constraint>,
  branch: Record<string, Constraint>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const constraintId of created) {
    changes.push(new CreateConstraint({ constraint: branch[constraintId] }));
  }

  for (const constraintId of dropped) {
    changes.push(new DropConstraint({ constraint: main[constraintId] }));
  }

  for (const constraintId of altered) {
    const mainConstraint = main[constraintId];
    const branchConstraint = branch[constraintId];

    // All constraint properties require dropping and recreating the constraint
    // since constraints have no alterable properties
    changes.push(
      new ReplaceConstraint({
        main: mainConstraint,
        branch: branchConstraint,
      }),
    );
  }

  return changes;
}
