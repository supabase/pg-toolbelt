import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { AlterTableChangeOwner, ReplaceTable } from "./changes/table.alter.ts";
import { CreateTable } from "./changes/table.create.ts";
import { DropTable } from "./changes/table.drop.ts";
import type { Table } from "./table.model.ts";

/**
 * Diff two sets of tables from main and branch catalogs.
 *
 * @param main - The tables in the main catalog.
 * @param branch - The tables in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffTables(
  main: Record<string, Table>,
  branch: Record<string, Table>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const tableId of created) {
    changes.push(new CreateTable({ table: branch[tableId] }));
  }

  for (const tableId of dropped) {
    changes.push(new DropTable({ table: main[tableId] }));
  }

  for (const tableId of altered) {
    const mainTable = main[tableId];
    const branchTable = branch[tableId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the table
    const nonAlterablePropsChanged =
      mainTable.persistence !== branchTable.persistence ||
      mainTable.row_security !== branchTable.row_security ||
      mainTable.force_row_security !== branchTable.force_row_security ||
      mainTable.has_indexes !== branchTable.has_indexes ||
      mainTable.has_rules !== branchTable.has_rules ||
      mainTable.has_triggers !== branchTable.has_triggers ||
      mainTable.has_subclasses !== branchTable.has_subclasses ||
      mainTable.is_populated !== branchTable.is_populated ||
      mainTable.replica_identity !== branchTable.replica_identity ||
      mainTable.is_partition !== branchTable.is_partition ||
      JSON.stringify(mainTable.options) !==
        JSON.stringify(branchTable.options) ||
      mainTable.partition_bound !== branchTable.partition_bound ||
      mainTable.parent_schema !== branchTable.parent_schema ||
      mainTable.parent_name !== branchTable.parent_name;

    if (nonAlterablePropsChanged) {
      // Replace the entire table (drop + create)
      changes.push(new ReplaceTable({ main: mainTable, branch: branchTable }));
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainTable.owner !== branchTable.owner) {
        changes.push(
          new AlterTableChangeOwner({
            main: mainTable,
            branch: branchTable,
          }),
        );
      }

      // Note: Table renaming would also use ALTER TABLE ... RENAME TO ...
      // But since our Table model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
