import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
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
    const nonAlterablePropsChanged =
      mainProcedure.kind !== branchProcedure.kind ||
      mainProcedure.return_type !== branchProcedure.return_type ||
      mainProcedure.return_type_schema !== branchProcedure.return_type_schema ||
      mainProcedure.language !== branchProcedure.language ||
      mainProcedure.security_definer !== branchProcedure.security_definer ||
      mainProcedure.volatility !== branchProcedure.volatility ||
      mainProcedure.parallel_safety !== branchProcedure.parallel_safety ||
      mainProcedure.is_strict !== branchProcedure.is_strict ||
      mainProcedure.leakproof !== branchProcedure.leakproof ||
      mainProcedure.returns_set !== branchProcedure.returns_set ||
      mainProcedure.argument_count !== branchProcedure.argument_count ||
      mainProcedure.argument_default_count !==
        branchProcedure.argument_default_count ||
      JSON.stringify(mainProcedure.argument_names) !==
        JSON.stringify(branchProcedure.argument_names) ||
      JSON.stringify(mainProcedure.argument_types) !==
        JSON.stringify(branchProcedure.argument_types) ||
      JSON.stringify(mainProcedure.all_argument_types) !==
        JSON.stringify(branchProcedure.all_argument_types) ||
      JSON.stringify(mainProcedure.argument_modes) !==
        JSON.stringify(branchProcedure.argument_modes) ||
      mainProcedure.argument_defaults !== branchProcedure.argument_defaults ||
      mainProcedure.source_code !== branchProcedure.source_code ||
      mainProcedure.binary_path !== branchProcedure.binary_path ||
      mainProcedure.sql_body !== branchProcedure.sql_body ||
      JSON.stringify(mainProcedure.config) !==
        JSON.stringify(branchProcedure.config);

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
