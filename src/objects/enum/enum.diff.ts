import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { AlterEnumChangeOwner, ReplaceEnum } from "./changes/enum.alter.ts";
import { CreateEnum } from "./changes/enum.create.ts";
import { DropEnum } from "./changes/enum.drop.ts";
import type { Enum } from "./enum.model.ts";

/**
 * Diff two sets of enums from main and branch catalogs.
 *
 * @param main - The enums in the main catalog.
 * @param branch - The enums in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffEnums(
  main: Record<string, Enum>,
  branch: Record<string, Enum>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const enumId of created) {
    changes.push(new CreateEnum({ enum: branch[enumId] }));
  }

  for (const enumId of dropped) {
    changes.push(new DropEnum({ enum: main[enumId] }));
  }

  for (const enumId of altered) {
    const mainEnum = main[enumId];
    const branchEnum = branch[enumId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the enum
    const nonAlterablePropsChanged =
      JSON.stringify(mainEnum.labels) !== JSON.stringify(branchEnum.labels);

    if (nonAlterablePropsChanged) {
      // Replace the entire enum (drop + create)
      changes.push(new ReplaceEnum({ main: mainEnum, branch: branchEnum }));
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainEnum.owner !== branchEnum.owner) {
        changes.push(
          new AlterEnumChangeOwner({
            main: mainEnum,
            branch: branchEnum,
          }),
        );
      }

      // Note: Enum renaming would also use ALTER TYPE ... RENAME TO ...
      // But since our Enum model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
