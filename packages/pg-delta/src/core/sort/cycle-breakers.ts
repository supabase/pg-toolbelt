import type { Change } from "../change.types.ts";
import { AlterPublicationDropTables } from "../objects/publication/changes/publication.alter.ts";
import {
  AlterTableDropColumn,
  AlterTableDropConstraint,
} from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import type { TableConstraintProps } from "../objects/table/table.model.ts";
import { stableId } from "../objects/utils.ts";

/**
 * Try to break an unbreakable cycle by INJECTING NEW CHANGES or REWRITING
 * existing ones (rather than removing graph edges).
 *
 * Called by `sortPhaseChanges` when its edge-removal cycle handler has seen
 * the same cycle twice — i.e. weak-edge filtering exhausted itself but the
 * cycle is still there. At that point we know the cycle is composed of
 * "hard" edges (explicit `requires` or pg_depend rows) that can only be
 * broken by changing the change list itself.
 *
 * Returns a rewritten `phaseChanges` array, or `null` if no breaker matches
 * (in which case the caller throws the existing CycleError).
 */
export function tryBreakCycleByChangeInjection(
  cycleNodeIndexes: readonly number[],
  phaseChanges: readonly Change[],
): Change[] | null {
  // ─── Branch A: FK cycle among DropTable changes ──────────────────────
  // Triggered when N≥2 dropped tables reference each other via foreign
  // keys. With no surviving table on either side, every FK constraint
  // stable-id ends up tied back to a DropTable node, and every
  // pg_depend row produces a hard explicit edge between two DropTables.
  // Edge filtering can't break it — the edges are not weak.
  //
  // Example (3-cycle):
  //   DROP TABLE a; DROP TABLE b; DROP TABLE c;
  //   where  a.b_id REFERENCES b,  b.c_id REFERENCES c,  c.a_id REFERENCES a
  //
  // Fix: inject a dedicated `ALTER TABLE ... DROP CONSTRAINT fk` ahead of
  // each DropTable in the cycle, and mark the constraint name on
  // `DropTable.externallyDroppedConstraints` so the table drop won't try
  // to re-claim the same constraint stable-id. The injected drops have
  // their own stable-id ownership and run before any DropTable, breaking
  // the cycle.
  //
  // This naturally handles any N (2-cycle, 3-cycle, …) because
  // `findCycle` already gave us the full member list — no separate SCC
  // enumeration needed.
  const fkBroken = tryBreakFkCycle(cycleNodeIndexes, phaseChanges);
  if (fkBroken) return fkBroken;

  // ─── Branch B: Publication ↔ Column on a surviving table ─────────────
  // Triggered when a publication has an explicit column list and one of
  // those columns is dropped on a table that itself is NOT being dropped
  // (the table just loses one column).
  //
  // Example:
  //   CREATE PUBLICATION p FOR TABLE lab_results (id, flash_summary);
  //   ALTER TABLE lab_results DROP COLUMN flash_summary;
  //
  // Diff emits two drop-phase changes:
  //   AlterPublicationDropTables(p, [lab_results])
  //   AlterTableDropColumn(lab_results.flash_summary)
  //
  // The cycle:
  //   pub:p → col:lab_results.flash_summary  (catalog, pg_depend)
  //   col:lab_results.flash_summary → table:lab_results
  //                                         (explicit, AlterTableDropColumn.requires)
  //
  // Fix: rebuild the AlterTableDropColumn with `omitTableRequirement=true`
  // so it no longer requires `table:lab_results`. Safe because
  // `lab_results` survives the migration; its lifetime trivially covers
  // the column drop. The catalog edge `pub → col` correctly orders the
  // publication drop before the column drop.
  const pubColBroken = tryBreakPublicationColumnCycle(
    cycleNodeIndexes,
    phaseChanges,
  );
  if (pubColBroken) return pubColBroken;

  // ─── Branch C: Publication ↔ dropped FK chain ↔ constraint drop ──────
  // Triggered when publication membership is being removed for tables in
  // the same drop phase as a FK chain, and the chain ends at a separately
  // emitted `AlterTableDropConstraint` on a table that is also being
  // removed from the publication.
  //
  // Example (4-change cycle):
  //   AlterPublicationDropTables(p, [labs, posts, post_attachments])
  //   DropTable(post_attachments)
  //   DropTable(posts)
  //   AlterTableDropConstraint(labs.unique_lab_id)
  //
  // Cycle:
  //   publication:p → table:post_attachments
  //   post_attachments.post_id_fkey → column:posts.id
  //   posts.lab_id_fkey → constraint:labs.unique_lab_id
  //   constraint:labs.unique_lab_id → table:labs
  //
  // Fix: inject explicit FK drops for the FK constraints claimed by the
  // DropTables in the cycle, including FKs that point at the terminal
  // dropped constraint. The publication and terminal constraint changes
  // stay unchanged; only the intermediate FK ownership is reassigned from
  // DropTable to dedicated AlterTableDropConstraint changes.
  const pubFkConstraintBroken = tryBreakPublicationFkConstraintDropCycle(
    cycleNodeIndexes,
    phaseChanges,
  );
  if (pubFkConstraintBroken) return pubFkConstraintBroken;

  // No known pattern. Returning null lets sortPhaseChanges throw the
  // formatted CycleError with full diagnostic — better a clear bug
  // report than silently shipping a broken plan.
  return null;
}

/**
 * Branch A worker — inject `AlterTableDropConstraint` for every FK linking
 * two DropTables in the cycle.
 *
 * Returns the rewritten changes array, or `null` if the cycle does not
 * match (e.g. mixed types, or no cross-cycle FK exists).
 */
function tryBreakFkCycle(
  cycleNodeIndexes: readonly number[],
  phaseChanges: readonly Change[],
): Change[] | null {
  // Guard: every member of the cycle must be a DropTable. Mixed cycles
  // (e.g. DropTable + DropView, or DropTable + DropMaterializedView) are
  // out of scope — they need a different breaker.
  const cycleDropTables: DropTable[] = [];
  for (const nodeIndex of cycleNodeIndexes) {
    const change = phaseChanges[nodeIndex];
    if (!(change instanceof DropTable)) return null;
    cycleDropTables.push(change);
  }

  const cycleTableIds = new Set(
    cycleDropTables.map((change) => change.table.stableId),
  );

  return injectFkConstraintDropsForDropTables({
    phaseChanges,
    dropTables: cycleDropTables,
    shouldInject: (fk, tableId) =>
      isCrossCycleFkConstraint(fk, tableId, cycleTableIds),
  });
}

type FkConstraintPredicate = (
  fk: TableConstraintProps,
  tableId: string,
) => boolean;

/**
 * Shared FK-drop injection used by Branch A and Branch C. The caller owns
 * the cycle-specific matcher; this helper only handles the mechanical
 * rewrite: add dedicated `AlterTableDropConstraint` changes and rebuild
 * affected `DropTable`s with updated `externallyDroppedConstraints`.
 */
function injectFkConstraintDropsForDropTables({
  phaseChanges,
  dropTables,
  shouldInject,
}: {
  phaseChanges: readonly Change[];
  dropTables: readonly DropTable[];
  shouldInject: FkConstraintPredicate;
}): Change[] | null {
  // For each DropTable in the cycle, find every FK whose referenced table
  // is also in the cycle. Each such FK becomes one injected
  // `AlterTableDropConstraint` and one entry on the source table's
  // `externallyDroppedConstraints`.
  //
  // 2-cycle example: { A→B, B→A } — two FKs, two injected drops.
  // 3-cycle example: { A→B, B→C, C→A } — three FKs, three injected drops.
  const injectedDropsByTableId = new Map<string, AlterTableDropConstraint[]>();
  const updatedExternalsByTableId = new Map<string, Set<string>>();
  let didMutate = false;

  for (const dropTable of dropTables) {
    const tableId = dropTable.table.stableId;
    const existingExternals = new Set(dropTable.externallyDroppedConstraints);
    let tableMutated = false;

    for (const fk of iterFkConstraints(dropTable.table.constraints)) {
      if (!shouldInject(fk, tableId)) continue;

      // Skip if a same-table `AlterTableDropConstraint` is already in the
      // change list — could happen if a previous breaker iteration
      // injected one, or the diff layer emitted one explicitly.
      if (existingExternals.has(fk.name)) continue;
      if (alreadyHasExplicitDrop(phaseChanges, tableId, fk.name)) continue;

      const injected = new AlterTableDropConstraint({
        table: dropTable.table,
        constraint: fk,
      });
      const list = injectedDropsByTableId.get(tableId) ?? [];
      list.push(injected);
      injectedDropsByTableId.set(tableId, list);
      existingExternals.add(fk.name);
      tableMutated = true;
      didMutate = true;
    }

    if (tableMutated) {
      updatedExternalsByTableId.set(tableId, existingExternals);
    }
  }

  if (!didMutate) return null;

  // Rebuild phaseChanges: keep all non-DropTable changes in place. For
  // each DropTable in the cycle that gained injected drops, emit the
  // injected drops first, then a fresh DropTable carrying the updated
  // `externallyDroppedConstraints` so it stops claiming the FK
  // stable-ids.
  const rewritten: Change[] = [];
  for (const change of phaseChanges) {
    if (!(change instanceof DropTable)) {
      rewritten.push(change);
      continue;
    }
    const tableId = change.table.stableId;
    const injected = injectedDropsByTableId.get(tableId);
    if (injected) {
      rewritten.push(...injected);
    }
    const updatedExternals = updatedExternalsByTableId.get(tableId);
    if (updatedExternals) {
      rewritten.push(
        new DropTable({
          table: change.table,
          externallyDroppedConstraints: updatedExternals,
        }),
      );
    } else {
      rewritten.push(change);
    }
  }
  return rewritten;
}

/**
 * Yield FK constraints on `constraints`.
 *
 * Partition clones are skipped because PostgreSQL drops them when the
 * parent constraint is dropped.
 */
function* iterFkConstraints(
  constraints: readonly TableConstraintProps[],
): Iterable<TableConstraintProps> {
  for (const constraint of constraints) {
    if (constraint.constraint_type !== "f") continue;
    if (constraint.is_partition_clone) continue;
    yield constraint;
  }
}

/**
 * True when `constraint` references another DropTable in the cycle.
 *
 * Self-referencing FKs are skipped — they create a self-loop in the
 * dependency graph which the existing sort-phase handler resolves on its
 * own; injecting an `AlterTableDropConstraint` for a self-FK would just
 * add noise.
 */
function isCrossCycleFkConstraint(
  constraint: TableConstraintProps,
  ownTableId: string,
  cycleTableIds: ReadonlySet<string>,
): boolean {
  if (!constraint.foreign_key_schema || !constraint.foreign_key_table) {
    return false;
  }
  const referencedId = stableId.table(
    constraint.foreign_key_schema,
    constraint.foreign_key_table,
  );
  if (referencedId === ownTableId) return false;
  return cycleTableIds.has(referencedId);
}

/**
 * True iff `phaseChanges` already contains an explicit
 * `AlterTableDropConstraint(table, constraint)` for the given pair —
 * either emitted by the diff layer or by a previous breaker iteration.
 * Avoids duplicate constraint drops.
 */
function alreadyHasExplicitDrop(
  phaseChanges: readonly Change[],
  tableId: string,
  constraintName: string,
): boolean {
  for (const change of phaseChanges) {
    if (!(change instanceof AlterTableDropConstraint)) continue;
    if (change.table.stableId !== tableId) continue;
    if (change.constraint.name === constraintName) return true;
  }
  return false;
}

/**
 * Branch B worker — break the publication↔column cycle by rebuilding the
 * `AlterTableDropColumn` change with `omitTableRequirement=true`.
 *
 * Returns the rewritten changes array, or `null` if the cycle does not
 * match (e.g. table is also being dropped, or no `AlterPublicationDropTables`
 * references the table).
 */
function tryBreakPublicationColumnCycle(
  cycleNodeIndexes: readonly number[],
  phaseChanges: readonly Change[],
): Change[] | null {
  // Find an `AlterTableDropColumn` and an `AlterPublicationDropTables` in
  // the cycle that reference the same table. Both must be present —
  // otherwise this is a different cycle shape.
  let dropColumnIndex = -1;
  let dropColumnChange: AlterTableDropColumn | null = null;
  let pubMatchesTable = false;
  let pubChange: AlterPublicationDropTables | null = null;

  for (const nodeIndex of cycleNodeIndexes) {
    const change = phaseChanges[nodeIndex];
    if (
      change instanceof AlterTableDropColumn &&
      !change.omitTableRequirement
    ) {
      dropColumnIndex = nodeIndex;
      dropColumnChange = change;
    } else if (change instanceof AlterPublicationDropTables) {
      pubChange = change;
    }
  }
  if (dropColumnChange === null || pubChange === null) return null;

  // Verify the publication is actually dropping membership for the same
  // table whose column is being dropped. Without this check we'd risk
  // rewriting an unrelated AlterTableDropColumn that happens to share a
  // cycle with some other publication change.
  const targetTableId = dropColumnChange.table.stableId;
  for (const t of pubChange.tables) {
    if (stableId.table(t.schema, t.name) === targetTableId) {
      pubMatchesTable = true;
      break;
    }
  }
  if (!pubMatchesTable) return null;

  // Verify the table is NOT itself being dropped. If `DropTable(T)` is in
  // the same phase, the existing structural rewrites in
  // `post-diff-normalization.ts` (replace-expansion superseded filter)
  // already prune the redundant `AlterTableDropColumn`, so we should not
  // see this combination here. Be defensive and bail anyway — flipping
  // `omitTableRequirement` when T is being dropped would let the column
  // drop reorder against the table drop, which is unsafe.
  for (const change of phaseChanges) {
    if (
      change instanceof DropTable &&
      change.table.stableId === targetTableId
    ) {
      return null;
    }
  }

  // Replace the AlterTableDropColumn with a fresh instance carrying
  // `omitTableRequirement=true`. All other changes pass through
  // unchanged.
  const rewritten: Change[] = phaseChanges.slice();
  rewritten[dropColumnIndex] = new AlterTableDropColumn({
    table: dropColumnChange.table,
    column: dropColumnChange.column,
    omitTableRequirement: true,
  });
  return rewritten;
}

/**
 * Branch C worker — break a publication membership removal cycle where
 * dropped tables form a FK chain ending at a separately dropped referenced
 * constraint.
 */
function tryBreakPublicationFkConstraintDropCycle(
  cycleNodeIndexes: readonly number[],
  phaseChanges: readonly Change[],
): Change[] | null {
  let pubChange: AlterPublicationDropTables | null = null;
  let terminalConstraintDrop: AlterTableDropConstraint | null = null;
  const dropTables: DropTable[] = [];

  for (const nodeIndex of cycleNodeIndexes) {
    const change = phaseChanges[nodeIndex];
    if (change instanceof AlterPublicationDropTables) {
      if (pubChange !== null) return null;
      pubChange = change;
    } else if (change instanceof AlterTableDropConstraint) {
      if (terminalConstraintDrop !== null) return null;
      terminalConstraintDrop = change;
    } else if (change instanceof DropTable) {
      dropTables.push(change);
    } else {
      return null;
    }
  }

  if (
    pubChange === null ||
    terminalConstraintDrop === null ||
    dropTables.length === 0
  ) {
    return null;
  }

  const publicationTableIds = new Set<string>(
    pubChange.tables.map((table) => stableId.table(table.schema, table.name)),
  );
  if (!publicationTableIds.has(terminalConstraintDrop.table.stableId)) {
    return null;
  }

  for (const dropTable of dropTables) {
    if (!publicationTableIds.has(dropTable.table.stableId)) return null;
  }

  const cycleDropTableIds = new Set(
    dropTables.map((change) => change.table.stableId),
  );
  let hasFkToTerminalConstraint = false;

  for (const dropTable of dropTables) {
    for (const fk of iterFkConstraints(dropTable.table.constraints)) {
      if (fkReferencesConstraint(fk, terminalConstraintDrop)) {
        hasFkToTerminalConstraint = true;
        break;
      }
    }
    if (hasFkToTerminalConstraint) break;
  }
  if (!hasFkToTerminalConstraint) return null;

  return injectFkConstraintDropsForDropTables({
    phaseChanges,
    dropTables,
    shouldInject: (fk, tableId) =>
      isCrossCycleFkConstraint(fk, tableId, cycleDropTableIds) ||
      fkReferencesConstraint(fk, terminalConstraintDrop),
  });
}

function fkReferencesConstraint(
  fk: TableConstraintProps,
  constraintDrop: AlterTableDropConstraint,
): boolean {
  if (
    fk.foreign_key_schema !== constraintDrop.table.schema ||
    fk.foreign_key_table !== constraintDrop.table.name ||
    fk.foreign_key_columns === null
  ) {
    return false;
  }

  return sameOrderedStrings(
    fk.foreign_key_columns,
    constraintDrop.constraint.key_columns,
  );
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
