import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import {
  AlterMaterializedViewChangeOwner,
  ReplaceMaterializedView,
} from "./changes/materialized-view.alter.ts";
import { CreateMaterializedView } from "./changes/materialized-view.create.ts";
import { DropMaterializedView } from "./changes/materialized-view.drop.ts";
import type { MaterializedView } from "./materialized-view.model.ts";

/**
 * Diff two sets of materialized views from main and branch catalogs.
 *
 * @param main - The materialized views in the main catalog.
 * @param branch - The materialized views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffMaterializedViews(
  main: Record<string, MaterializedView>,
  branch: Record<string, MaterializedView>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const materializedViewId of created) {
    changes.push(
      new CreateMaterializedView({
        materializedView: branch[materializedViewId],
      }),
    );
  }

  for (const materializedViewId of dropped) {
    changes.push(
      new DropMaterializedView({ materializedView: main[materializedViewId] }),
    );
  }

  for (const materializedViewId of altered) {
    const mainMaterializedView = main[materializedViewId];
    const branchMaterializedView = branch[materializedViewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the materialized view
    const nonAlterablePropsChanged =
      mainMaterializedView.definition !== branchMaterializedView.definition ||
      mainMaterializedView.row_security !==
        branchMaterializedView.row_security ||
      mainMaterializedView.force_row_security !==
        branchMaterializedView.force_row_security ||
      mainMaterializedView.has_indexes !== branchMaterializedView.has_indexes ||
      mainMaterializedView.has_rules !== branchMaterializedView.has_rules ||
      mainMaterializedView.has_triggers !==
        branchMaterializedView.has_triggers ||
      mainMaterializedView.has_subclasses !==
        branchMaterializedView.has_subclasses ||
      mainMaterializedView.is_populated !==
        branchMaterializedView.is_populated ||
      mainMaterializedView.replica_identity !==
        branchMaterializedView.replica_identity ||
      mainMaterializedView.is_partition !==
        branchMaterializedView.is_partition ||
      JSON.stringify(mainMaterializedView.options) !==
        JSON.stringify(branchMaterializedView.options) ||
      mainMaterializedView.partition_bound !==
        branchMaterializedView.partition_bound;

    if (nonAlterablePropsChanged) {
      // Replace the entire materialized view (drop + create)
      changes.push(
        new ReplaceMaterializedView({
          main: mainMaterializedView,
          branch: branchMaterializedView,
        }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainMaterializedView.owner !== branchMaterializedView.owner) {
        changes.push(
          new AlterMaterializedViewChangeOwner({
            main: mainMaterializedView,
            branch: branchMaterializedView,
          }),
        );
      }

      // Note: Materialized view renaming would also use ALTER MATERIALIZED VIEW ... RENAME TO ...
      // But since our MaterializedView model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
