import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import {
  AlterExtensionChangeOwner,
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
  ReplaceExtension,
} from "./changes/extension.alter.ts";
import { CreateExtension } from "./changes/extension.create.ts";
import { DropExtension } from "./changes/extension.drop.ts";
import type { Extension } from "./extension.model.ts";

/**
 * Diff two sets of extensions from main and branch catalogs.
 *
 * @param main - The extensions in the main catalog.
 * @param branch - The extensions in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffExtensions(
  main: Record<string, Extension>,
  branch: Record<string, Extension>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const extensionId of created) {
    changes.push(new CreateExtension({ extension: branch[extensionId] }));
  }

  for (const extensionId of dropped) {
    changes.push(new DropExtension({ extension: main[extensionId] }));
  }

  for (const extensionId of altered) {
    const mainExtension = main[extensionId];
    const branchExtension = branch[extensionId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the extension
    const NON_ALTERABLE_FIELDS: Array<keyof Extension> = [];
    const nonAlterablePropsChanged =
      hasNonAlterableChanges(
        mainExtension,
        branchExtension,
        NON_ALTERABLE_FIELDS,
      ) || !mainExtension.relocatable;

    if (nonAlterablePropsChanged) {
      // Replace the entire extension (drop + create)
      changes.push(
        new ReplaceExtension({ main: mainExtension, branch: branchExtension }),
      );
    } else {
      // Only alterable properties changed - check each one

      // VERSION
      if (mainExtension.version !== branchExtension.version) {
        changes.push(
          new AlterExtensionUpdateVersion({
            main: mainExtension,
            branch: branchExtension,
          }),
        );
      }

      // SCHEMA (only if relocatable)
      if (
        mainExtension.relocatable &&
        mainExtension.schema !== branchExtension.schema
      ) {
        changes.push(
          new AlterExtensionSetSchema({
            main: mainExtension,
            branch: branchExtension,
          }),
        );
      }

      // OWNER
      if (mainExtension.owner !== branchExtension.owner) {
        changes.push(
          new AlterExtensionChangeOwner({
            main: mainExtension,
            branch: branchExtension,
          }),
        );
      }

      // Note: Extension renaming would also use ALTER EXTENSION ... RENAME TO ...
      // But since our Extension model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
