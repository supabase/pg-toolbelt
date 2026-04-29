import type { Change } from "./change.types.ts";
import {
  AlterTableAddConstraint,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableValidateConstraint,
} from "./objects/table/changes/table.alter.ts";
import { CreateCommentOnConstraint } from "./objects/table/changes/table.comment.ts";
import { stableId } from "./objects/utils.ts";

function constraintStableId(
  table: { schema: string; name: string },
  constraintName: string,
) {
  return stableId.constraint(table.schema, table.name, constraintName);
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

/**
 * Drop earlier duplicates of `AlterTableAddConstraint` /
 * `AlterTableValidateConstraint` / `CreateCommentOnConstraint` targeting
 * replaced tables, keeping only the last occurrence of each
 * `(changeType, table.stableId, constraint.name)`.
 *
 * When `expandReplaceDependencies()` promotes a table to a full
 * `DropTable + CreateTable` pair, it also emits one
 * `AlterTableAddConstraint` (plus optional `VALIDATE CONSTRAINT` /
 * `COMMENT ON CONSTRAINT`) per branch constraint. If `diffTables()` already
 * emitted the same change for a shape flip or a new constraint on that
 * table, the plan ends up with two identical `ALTER TABLE ... ADD
 * CONSTRAINT ...` statements and PostgreSQL fails at apply time with
 * `constraint "..." for relation "..." already exists`. Because
 * `expandReplaceDependencies()` appends its additions after the original
 * `diffTables()` output, the last occurrence is the expansion's emission —
 * keeping it preserves correctness while removing the duplicate.
 */
function dropReplacedTableDuplicateConstraintChanges(
  changes: Change[],
  replacedTableIds: ReadonlySet<string>,
): Change[] {
  if (replacedTableIds.size === 0) return changes;

  const keyFor = (change: Change): string | null => {
    if (
      !(change instanceof AlterTableAddConstraint) &&
      !(change instanceof AlterTableValidateConstraint) &&
      !(change instanceof CreateCommentOnConstraint)
    ) {
      return null;
    }
    if (!replacedTableIds.has(change.table.stableId)) return null;
    const tag =
      change instanceof AlterTableAddConstraint
        ? "add"
        : change instanceof AlterTableValidateConstraint
          ? "validate"
          : "comment";
    return `${tag}:${constraintStableId(change.table, change.constraint.name)}`;
  };

  const seen = new Set<string>();
  const reversedKept: Change[] = [];
  let mutated = false;

  // Walk backwards: the first encounter of each key corresponds to its LAST
  // occurrence in the original order. `expandReplaceDependencies()` appends
  // additions after the original changes, so "last wins" keeps the
  // expansion's emission and drops the earlier diffTables duplicate.
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i] as Change;
    const key = keyFor(change);
    if (key !== null) {
      if (seen.has(key)) {
        mutated = true;
        continue;
      }
      seen.add(key);
    }
    reversedKept.push(change);
  }

  return mutated ? reversedKept.reverse() : changes;
}

/**
 * Apply structural rewrites to the change list that are only obvious once
 * every object diff has been collected. This pass does NOT prevent dependency
 * cycles — that responsibility now lives in the sort phase, where
 * `sortPhaseChanges` invokes `tryBreakCycleByChangeInjection` lazily on cycles
 * that edge filtering can't break (FK SCC of dropped tables,
 * AlterPublicationDropTables ↔ AlterTableDropColumn, …).
 *
 * Concretely, this pass:
 *
 * - Prunes `AlterTableDropColumn(T.*)` / `AlterTableDropConstraint(T.*)`
 *   changes that are made redundant by an expansion-emitted
 *   `DropTable(T) + CreateTable(T)` pair. Without this, the apply phase
 *   would try to drop a column that no longer exists in the freshly
 *   recreated table.
 * - Dedupes duplicate `AlterTableAddConstraint` /
 *   `AlterTableValidateConstraint` / `CreateCommentOnConstraint` changes
 *   produced when `diffTables()` and `expandReplaceDependencies()` both
 *   emit the same constraint operation for a replaced table. Last write
 *   wins so the expansion's emission survives.
 *
 * Object-local PostgreSQL semantics (for example owned-sequence cascades)
 * stay in the corresponding `diff*` function instead of this pass.
 */
export function normalizePostDiffCycles({
  changes,
  replacedTableIds = new Set<string>(),
}: {
  changes: Change[];
  replacedTableIds?: ReadonlySet<string>;
}): Change[] {
  const dedupedChanges = dropReplacedTableDuplicateConstraintChanges(
    changes,
    replacedTableIds,
  );

  if (replacedTableIds.size === 0) return dedupedChanges;

  return dedupedChanges.filter(
    (change) => !isSupersededByTableReplacement(change, replacedTableIds),
  );
}
