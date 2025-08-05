import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import {
  AlterCompositeTypeChangeOwner,
  ReplaceCompositeType,
} from "./changes/composite-type.alter.ts";
import { CreateCompositeType } from "./changes/composite-type.create.ts";
import { DropCompositeType } from "./changes/composite-type.drop.ts";
import type { CompositeType } from "./composite-type.model.ts";

/**
 * Diff two sets of composite types from main and branch catalogs.
 *
 * @param main - The composite types in the main catalog.
 * @param branch - The composite types in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffCompositeTypes(
  main: Record<string, CompositeType>,
  branch: Record<string, CompositeType>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const compositeTypeId of created) {
    changes.push(
      new CreateCompositeType({ compositeType: branch[compositeTypeId] }),
    );
  }

  for (const compositeTypeId of dropped) {
    changes.push(
      new DropCompositeType({ compositeType: main[compositeTypeId] }),
    );
  }

  for (const compositeTypeId of altered) {
    const mainCompositeType = main[compositeTypeId];
    const branchCompositeType = branch[compositeTypeId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the composite type
    const nonAlterablePropsChanged =
      mainCompositeType.row_security !== branchCompositeType.row_security ||
      mainCompositeType.force_row_security !==
        branchCompositeType.force_row_security ||
      mainCompositeType.has_indexes !== branchCompositeType.has_indexes ||
      mainCompositeType.has_rules !== branchCompositeType.has_rules ||
      mainCompositeType.has_triggers !== branchCompositeType.has_triggers ||
      mainCompositeType.has_subclasses !== branchCompositeType.has_subclasses ||
      mainCompositeType.is_populated !== branchCompositeType.is_populated ||
      mainCompositeType.replica_identity !==
        branchCompositeType.replica_identity ||
      mainCompositeType.is_partition !== branchCompositeType.is_partition ||
      JSON.stringify(mainCompositeType.options) !==
        JSON.stringify(branchCompositeType.options) ||
      mainCompositeType.partition_bound !== branchCompositeType.partition_bound;

    if (nonAlterablePropsChanged) {
      // Replace the entire composite type (drop + create)
      changes.push(
        new ReplaceCompositeType({
          main: mainCompositeType,
          branch: branchCompositeType,
        }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainCompositeType.owner !== branchCompositeType.owner) {
        changes.push(
          new AlterCompositeTypeChangeOwner({
            main: mainCompositeType,
            branch: branchCompositeType,
          }),
        );
      }

      // Note: Composite type renaming would also use ALTER TYPE ... RENAME TO ...
      // But since our CompositeType model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
