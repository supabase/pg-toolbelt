import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import { AlterTypeChangeOwner, ReplaceType } from "./changes/type.alter.ts";
import { CreateType } from "./changes/type.create.ts";
import { DropType } from "./changes/type.drop.ts";
import type { Type } from "./type.model.ts";

/**
 * Diff two sets of types from main and branch catalogs.
 *
 * @param main - The types in the main catalog.
 * @param branch - The types in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffTypes(
  main: Record<string, Type>,
  branch: Record<string, Type>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const typeId of created) {
    changes.push(new CreateType({ type: branch[typeId] }));
  }

  for (const typeId of dropped) {
    changes.push(new DropType({ type: main[typeId] }));
  }

  for (const typeId of altered) {
    const mainType = main[typeId];
    const branchType = branch[typeId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the type
    const NON_ALTERABLE_FIELDS: Array<keyof Type> = [
      "type_type",
      "type_category",
      "is_preferred",
      "is_defined",
      "delimiter",
      "storage_length",
      "passed_by_value",
      "alignment",
      "storage",
      "not_null",
      "type_modifier",
      "array_dimensions",
      "default_bin",
      "default_value",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainType,
      branchType,
      NON_ALTERABLE_FIELDS,
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire type (drop + create)
      changes.push(new ReplaceType({ main: mainType, branch: branchType }));
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainType.owner !== branchType.owner) {
        changes.push(
          new AlterTypeChangeOwner({
            main: mainType,
            branch: branchType,
          }),
        );
      }

      // Note: Type renaming would also use ALTER TYPE ... RENAME TO ...
      // But since our Type model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
