import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { AlterViewChangeOwner, ReplaceView } from "./changes/view.alter.ts";
import { CreateView } from "./changes/view.create.ts";
import { DropView } from "./changes/view.drop.ts";
import type { View } from "./view.model.ts";

/**
 * Diff two sets of views from main and branch catalogs.
 *
 * @param main - The views in the main catalog.
 * @param branch - The views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffViews(
  main: Record<string, View>,
  branch: Record<string, View>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const viewId of created) {
    changes.push(new CreateView({ view: branch[viewId] }));
  }

  for (const viewId of dropped) {
    changes.push(new DropView({ view: main[viewId] }));
  }

  for (const viewId of altered) {
    const mainView = main[viewId];
    const branchView = branch[viewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the view
    const nonAlterablePropsChanged =
      mainView.definition !== branchView.definition ||
      mainView.row_security !== branchView.row_security ||
      mainView.force_row_security !== branchView.force_row_security ||
      mainView.has_indexes !== branchView.has_indexes ||
      mainView.has_rules !== branchView.has_rules ||
      mainView.has_triggers !== branchView.has_triggers ||
      mainView.has_subclasses !== branchView.has_subclasses ||
      mainView.is_populated !== branchView.is_populated ||
      mainView.replica_identity !== branchView.replica_identity ||
      mainView.is_partition !== branchView.is_partition ||
      JSON.stringify(mainView.options) !== JSON.stringify(branchView.options) ||
      mainView.partition_bound !== branchView.partition_bound;

    if (nonAlterablePropsChanged) {
      // Replace the entire view (drop + create)
      changes.push(new ReplaceView({ main: mainView, branch: branchView }));
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainView.owner !== branchView.owner) {
        changes.push(
          new AlterViewChangeOwner({
            main: mainView,
            branch: branchView,
          }),
        );
      }

      // Note: View renaming would also use ALTER VIEW ... RENAME TO ...
      // But since our View model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
