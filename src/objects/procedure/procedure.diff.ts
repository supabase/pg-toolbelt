import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterProcedureChangeOwner,
  ReplaceProcedure,
} from "./changes/procedure.alter.ts";
import { CreateProcedure } from "./changes/procedure.create.ts";
import { DropProcedure } from "./changes/procedure.drop.ts";
import type { Procedure } from "./procedure.model.ts";

/**
 * Diff two sets of procedures from main and branch catalogs.
 *
 * @param main - The procedures in the main catalog.
 * @param branch - The procedures in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffProcedures(
  main: Record<string, Procedure>,
  branch: Record<string, Procedure>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const procedureId of created) {
    changes.push(new CreateProcedure({ procedure: branch[procedureId] }));
  }

  for (const procedureId of dropped) {
    changes.push(new DropProcedure({ procedure: main[procedureId] }));
  }

  for (const procedureId of altered) {
    const mainProcedure = main[procedureId];
    const branchProcedure = branch[procedureId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the procedure
    const NON_ALTERABLE_FIELDS: Array<keyof Procedure> = [
      "kind",
      "return_type",
      "return_type_schema",
      "language",
      "security_definer",
      "volatility",
      "parallel_safety",
      "is_strict",
      "leakproof",
      "returns_set",
      "argument_count",
      "argument_default_count",
      "argument_names",
      "argument_types",
      "all_argument_types",
      "argument_modes",
      "argument_defaults",
      "source_code",
      "binary_path",
      "sql_body",
      "config",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainProcedure,
      branchProcedure,
      NON_ALTERABLE_FIELDS,
      {
        argument_names: deepEqual,
        argument_types: deepEqual,
        all_argument_types: deepEqual,
        argument_modes: deepEqual,
        config: deepEqual,
      },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire procedure (drop + create)
      changes.push(
        new ReplaceProcedure({ main: mainProcedure, branch: branchProcedure }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainProcedure.owner !== branchProcedure.owner) {
        changes.push(
          new AlterProcedureChangeOwner({
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // Note: Procedure renaming would also use ALTER FUNCTION/PROCEDURE ... RENAME TO ...
      // But since our Procedure model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
