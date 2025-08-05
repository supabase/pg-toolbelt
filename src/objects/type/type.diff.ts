import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
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
    const nonAlterablePropsChanged =
      mainType.type_type !== branchType.type_type ||
      mainType.type_category !== branchType.type_category ||
      mainType.is_preferred !== branchType.is_preferred ||
      mainType.is_defined !== branchType.is_defined ||
      mainType.delimiter !== branchType.delimiter ||
      mainType.storage_length !== branchType.storage_length ||
      mainType.passed_by_value !== branchType.passed_by_value ||
      mainType.alignment !== branchType.alignment ||
      mainType.storage !== branchType.storage ||
      mainType.not_null !== branchType.not_null ||
      mainType.type_modifier !== branchType.type_modifier ||
      mainType.array_dimensions !== branchType.array_dimensions ||
      mainType.default_bin !== branchType.default_bin ||
      mainType.default_value !== branchType.default_value;

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
