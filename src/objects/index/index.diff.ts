import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
  AlterIndexSetTablespace,
  ReplaceIndex,
} from "./changes/index.alter.ts";
import { CreateIndex } from "./changes/index.create.ts";
import { DropIndex } from "./changes/index.drop.ts";
import type { Index } from "./index.model.ts";

/**
 * Diff two sets of indexes from main and branch catalogs.
 *
 * @param main - The indexes in the main catalog.
 * @param branch - The indexes in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffIndexes(
  main: Record<string, Index>,
  branch: Record<string, Index>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const indexId of created) {
    changes.push(new CreateIndex({ index: branch[indexId] }));
  }

  for (const indexId of dropped) {
    changes.push(new DropIndex({ index: main[indexId] }));
  }

  for (const indexId of altered) {
    const mainIndex = main[indexId];
    const branchIndex = branch[indexId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the index
    const nonAlterablePropsChanged =
      mainIndex.index_type !== branchIndex.index_type ||
      mainIndex.is_unique !== branchIndex.is_unique ||
      mainIndex.is_primary !== branchIndex.is_primary ||
      mainIndex.is_exclusion !== branchIndex.is_exclusion ||
      mainIndex.nulls_not_distinct !== branchIndex.nulls_not_distinct ||
      mainIndex.immediate !== branchIndex.immediate ||
      mainIndex.is_clustered !== branchIndex.is_clustered ||
      mainIndex.is_replica_identity !== branchIndex.is_replica_identity ||
      JSON.stringify(mainIndex.key_columns) !==
        JSON.stringify(branchIndex.key_columns) ||
      JSON.stringify(mainIndex.column_collations) !==
        JSON.stringify(branchIndex.column_collations) ||
      JSON.stringify(mainIndex.operator_classes) !==
        JSON.stringify(branchIndex.operator_classes) ||
      JSON.stringify(mainIndex.column_options) !==
        JSON.stringify(branchIndex.column_options) ||
      mainIndex.index_expressions !== branchIndex.index_expressions ||
      mainIndex.partial_predicate !== branchIndex.partial_predicate;

    if (nonAlterablePropsChanged) {
      // Replace the entire index (drop + create)
      changes.push(new ReplaceIndex({ main: mainIndex, branch: branchIndex }));
    } else {
      // Only alterable properties changed - check each one

      // STORAGE PARAMS
      if (
        JSON.stringify(mainIndex.storage_params) !==
        JSON.stringify(branchIndex.storage_params)
      ) {
        changes.push(
          new AlterIndexSetStorageParams({
            main: mainIndex,
            branch: branchIndex,
          }),
        );
      }

      // STATISTICS TARGET
      if (
        JSON.stringify(mainIndex.statistics_target) !==
        JSON.stringify(branchIndex.statistics_target)
      ) {
        changes.push(
          new AlterIndexSetStatistics({ main: mainIndex, branch: branchIndex }),
        );
      }

      // TABLESPACE
      if (mainIndex.tablespace !== branchIndex.tablespace) {
        changes.push(
          new AlterIndexSetTablespace({ main: mainIndex, branch: branchIndex }),
        );
      }

      // Note: Index renaming would also use ALTER INDEX ... RENAME TO ...
      // But since our Index model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
