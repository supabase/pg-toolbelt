import type { Change } from "./change.types.ts";
import { CreateIndex } from "./objects/index/changes/index.create.ts";
import { DropIndex } from "./objects/index/changes/index.drop.ts";
import {
  AlterTableAddConstraint,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableSetReplicaIdentity,
  AlterTableValidateConstraint,
} from "./objects/table/changes/table.alter.ts";
import { CreateCommentOnConstraint } from "./objects/table/changes/table.comment.ts";
import type { Table } from "./objects/table/table.model.ts";
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
 * Re-emit `ALTER TABLE ... REPLICA IDENTITY USING INDEX <idx>` after any
 * `DropIndex(idx) + CreateIndex(idx)` pair where `idx` is the replica-identity
 * index of a branch table.
 *
 * Background: PostgreSQL silently flips a table's `relreplident` to `'d'`
 * (DEFAULT) when the index it points to is dropped. `CREATE INDEX` cannot
 * restore the marker — only `ALTER TABLE ... REPLICA IDENTITY USING INDEX`
 * can. When both main and branch carry `replica_identity = 'i'` pointing at
 * the same index name, `diffTables()` emits no replica-identity change of its
 * own, so the marker would be lost on apply.
 *
 * This is a whole-plan interaction: `diffTables()` cannot detect it without
 * also looking at index changes. Per the "whole-plan interactions belong in
 * post-diff normalization" rule in the package CLAUDE.md, the restoration
 * lives here.
 *
 * Insertion is idempotent: if `diffTables()` already emitted the same
 * `AlterTableSetReplicaIdentity` for this table (e.g. when the user is also
 * switching the replica-identity index name in the same migration), no
 * duplicate is added.
 */
function restoreReplicaIdentityAfterIndexReplace(
  changes: Change[],
  branchTables: Record<string, Table>,
): Change[] {
  // Build the index-stable-id → owning-table map from branch state. Only
  // tables in 'i' mode contribute, and only those whose configured index name
  // is non-null (the extractor returns null for any other mode).
  const replicaIdentityIndexToTable = new Map<string, Table>();
  for (const table of Object.values(branchTables)) {
    if (table.replica_identity !== "i" || !table.replica_identity_index) {
      continue;
    }
    const indexId = `index:${table.schema}.${table.name}.${table.replica_identity_index}`;
    replicaIdentityIndexToTable.set(indexId, table);
  }
  if (replicaIdentityIndexToTable.size === 0) return changes;

  // Find the indexes that are both dropped AND created in this plan. A pure
  // drop or a pure create is handled by `diffTables()` directly (the table's
  // replica_identity / replica_identity_index fields will have changed). The
  // hole is specifically the drop+create pair that recreates the same name.
  const droppedIndexIds = new Set<string>();
  const createdIndexIds = new Set<string>();
  for (const change of changes) {
    if (change instanceof DropIndex) {
      droppedIndexIds.add(change.index.stableId);
    } else if (change instanceof CreateIndex) {
      createdIndexIds.add(change.index.stableId);
    }
  }
  const replacedIndexIds = new Set<string>();
  for (const id of droppedIndexIds) {
    if (createdIndexIds.has(id) && replicaIdentityIndexToTable.has(id)) {
      replacedIndexIds.add(id);
    }
  }
  if (replacedIndexIds.size === 0) return changes;

  // Skip tables for which `diffTables()` already emitted a replica-identity
  // setter — re-emitting would produce a redundant ALTER TABLE (harmless on
  // apply, but noisy in plan output).
  const tablesWithExistingReplicaIdentitySetter = new Set<string>();
  for (const change of changes) {
    if (change instanceof AlterTableSetReplicaIdentity) {
      tablesWithExistingReplicaIdentitySetter.add(change.table.stableId);
    }
  }

  // Insert one `AlterTableSetReplicaIdentity` per replaced index, immediately
  // after the matching `CreateIndex`. The change's `requires` already names
  // both the table and the recreated index, so the topo sort orders it
  // correctly relative to the surrounding DDL.
  const result: Change[] = [];
  for (const change of changes) {
    result.push(change);
    if (
      !(change instanceof CreateIndex) ||
      !replacedIndexIds.has(change.index.stableId)
    ) {
      continue;
    }
    const table = replicaIdentityIndexToTable.get(change.index.stableId);
    if (!table) continue;
    if (tablesWithExistingReplicaIdentitySetter.has(table.stableId)) continue;

    result.push(
      new AlterTableSetReplicaIdentity({
        table,
        mode: "i",
        indexName: table.replica_identity_index,
      }),
    );
    // Mark as emitted so a second replaced index on the same table — if that
    // ever arises — doesn't double-emit.
    tablesWithExistingReplicaIdentitySetter.add(table.stableId);
  }

  return result;
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
 * - Re-emits `ALTER TABLE ... REPLICA IDENTITY USING INDEX <idx>` after any
 *   `DropIndex(idx) + CreateIndex(idx)` pair where `idx` is the replica
 *   identity index of a branch table — Postgres silently clears the marker
 *   when the underlying index is dropped, and `CREATE INDEX` cannot restore
 *   it.
 *
 * Object-local PostgreSQL semantics (for example owned-sequence cascades)
 * stay in the corresponding `diff*` function instead of this pass.
 */
export function normalizePostDiffCycles({
  changes,
  replacedTableIds = new Set<string>(),
  branchTables = {},
}: {
  changes: Change[];
  replacedTableIds?: ReadonlySet<string>;
  branchTables?: Record<string, Table>;
}): Change[] {
  const restoredChanges = restoreReplicaIdentityAfterIndexReplace(
    changes,
    branchTables,
  );

  const dedupedChanges = dropReplacedTableDuplicateConstraintChanges(
    restoredChanges,
    replacedTableIds,
  );

  if (replacedTableIds.size === 0) return dedupedChanges;

  return dedupedChanges.filter(
    (change) => !isSupersededByTableReplacement(change, replacedTableIds),
  );
}
