import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import {
  AlterTableDropColumn,
  AlterTableDropConstraint,
} from "./objects/table/changes/table.alter.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { stableId } from "./objects/utils.ts";

function constraintStableId(
  table: { schema: string; name: string },
  constraintName: string,
) {
  return stableId.constraint(table.schema, table.name, constraintName);
}

/**
 * Yield FK constraints on `table` whose referenced table is also dropped in the
 * final plan. Self-references are left alone because the sort phase already
 * handles the resulting self-loop correctly.
 */
function* iterCrossDropFkConstraints(
  table: Catalog["tables"][string],
  droppedSet: ReadonlySet<string>,
) {
  for (const constraint of table.constraints) {
    if (constraint.constraint_type !== "f") continue;
    if (constraint.is_partition_clone) continue;
    if (!constraint.foreign_key_schema || !constraint.foreign_key_table) {
      continue;
    }
    const referencedId = stableId.table(
      constraint.foreign_key_schema,
      constraint.foreign_key_table,
    );
    if (referencedId === table.stableId) continue;
    if (!droppedSet.has(referencedId)) continue;
    yield { constraint, referencedId };
  }
}

function isSupersededByTableReplacement(
  change: Change,
  replacedTableIds: ReadonlySet<string>,
): boolean {
  if (
    !(change instanceof AlterTableDropColumn) &&
    !(change instanceof AlterTableDropConstraint)
  ) {
    return false;
  }
  return replacedTableIds.has(change.table.stableId);
}

function collectExplicitConstraintDropIds(changes: Change[]) {
  const explicitConstraintDropIds = new Set<string>();

  for (const change of changes) {
    if (!(change instanceof AlterTableDropConstraint)) continue;
    explicitConstraintDropIds.add(
      constraintStableId(change.table, change.constraint.name),
    );
  }

  return explicitConstraintDropIds;
}

function hasSameEntries(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

/**
 * Normalize change-list cycles that only become apparent after all object
 * diffs have been collected.
 *
 * This pass intentionally handles whole-plan interactions only:
 * - If replace expansion added `DropTable(T)+CreateTable(T)`, targeted
 *   `AlterTableDropColumn(T.*)` / `AlterTableDropConstraint(T.*)` changes are
 *   redundant and create an unbreakable drop-phase cycle, so we elide them.
 * - If two dropped tables reference each other via FK, we insert dedicated
 *   `AlterTableDropConstraint` changes and teach the paired `DropTable`
 *   changes not to claim those FK stable IDs.
 *
 * Object-local PostgreSQL semantics (for example owned-sequence cascades) stay
 * in the corresponding `diff*` function instead of this pass.
 */
export function normalizePostDiffCycles({
  changes,
  mainCatalog,
  replacedTableIds = new Set<string>(),
}: {
  changes: Change[];
  mainCatalog: Catalog;
  replacedTableIds?: ReadonlySet<string>;
}): Change[] {
  const structurallyNormalizedChanges =
    replacedTableIds.size === 0
      ? changes
      : changes.filter(
          (change) =>
            !isSupersededByTableReplacement(change, replacedTableIds),
        );

  const dropTableChanges = structurallyNormalizedChanges.filter(
    (change): change is DropTable => change instanceof DropTable,
  );

  if (dropTableChanges.length < 2) {
    return structurallyNormalizedChanges;
  }

  const droppedSet = new Set(
    dropTableChanges.map((change) => change.table.stableId),
  );
  const droppedFkTargets = new Map<string, Set<string>>();

  for (const dropTableChange of dropTableChanges) {
    const mainTable =
      mainCatalog.tables[dropTableChange.table.stableId] ?? dropTableChange.table;
    const targets = new Set<string>();

    for (const { referencedId } of iterCrossDropFkConstraints(mainTable, droppedSet)) {
      targets.add(referencedId);
    }

    droppedFkTargets.set(mainTable.stableId, targets);
  }

  const explicitConstraintDropIds = collectExplicitConstraintDropIds(
    structurallyNormalizedChanges,
  );
  const injectedConstraintDropsByTableId = new Map<
    string,
    AlterTableDropConstraint[]
  >();
  const externallyDroppedConstraintsByTableId = new Map<string, ReadonlySet<string>>();
  let didMutate = structurallyNormalizedChanges !== changes;

  for (const dropTableChange of dropTableChanges) {
    const mainTable =
      mainCatalog.tables[dropTableChange.table.stableId] ?? dropTableChange.table;
    const externallyDroppedConstraints = new Set(
      dropTableChange.externallyDroppedConstraints,
    );

    for (const { constraint, referencedId } of iterCrossDropFkConstraints(
      mainTable,
      droppedSet,
    )) {
      const isMutual =
        droppedFkTargets.get(referencedId)?.has(mainTable.stableId) === true;
      if (!isMutual) continue;

      const droppedConstraintStableId = constraintStableId(
        mainTable,
        constraint.name,
      );
      externallyDroppedConstraints.add(constraint.name);

      if (!explicitConstraintDropIds.has(droppedConstraintStableId)) {
        const injectedDrop = new AlterTableDropConstraint({
          table: mainTable,
          constraint,
        });
        const existingDrops =
          injectedConstraintDropsByTableId.get(mainTable.stableId) ?? [];
        existingDrops.push(injectedDrop);
        injectedConstraintDropsByTableId.set(mainTable.stableId, existingDrops);
        explicitConstraintDropIds.add(droppedConstraintStableId);
        didMutate = true;
      }
    }

    if (
      !hasSameEntries(
        dropTableChange.externallyDroppedConstraints,
        externallyDroppedConstraints,
      )
    ) {
      externallyDroppedConstraintsByTableId.set(
        mainTable.stableId,
        externallyDroppedConstraints,
      );
      didMutate = true;
    }
  }

  if (!didMutate) {
    return changes;
  }

  const normalizedChanges: Change[] = [];

  for (const change of structurallyNormalizedChanges) {
    if (!(change instanceof DropTable)) {
      normalizedChanges.push(change);
      continue;
    }

    const injectedConstraintDrops =
      injectedConstraintDropsByTableId.get(change.table.stableId) ?? [];
    if (injectedConstraintDrops.length > 0) {
      normalizedChanges.push(...injectedConstraintDrops);
    }

    const externallyDroppedConstraints =
      externallyDroppedConstraintsByTableId.get(change.table.stableId);
    if (!externallyDroppedConstraints) {
      normalizedChanges.push(change);
      continue;
    }

    normalizedChanges.push(
      new DropTable({
        table: change.table,
        externallyDroppedConstraints,
      }),
    );
  }

  return normalizedChanges;
}
