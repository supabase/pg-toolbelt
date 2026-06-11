import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import type { ObjectDiffContext } from "./objects/diff-context.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainSetDefault,
} from "./objects/domain/changes/domain.alter.ts";
import { CreateDomain } from "./objects/domain/changes/domain.create.ts";
import { DropDomain } from "./objects/domain/changes/domain.drop.ts";
import { AlterIndexSetStatistics } from "./objects/index/changes/index.alter.ts";
import { CreateCommentOnIndex } from "./objects/index/changes/index.comment.ts";
import { CreateIndex } from "./objects/index/changes/index.create.ts";
import { DropIndex } from "./objects/index/changes/index.drop.ts";
import { CreateMaterializedView } from "./objects/materialized-view/changes/materialized-view.create.ts";
import { DropMaterializedView } from "./objects/materialized-view/changes/materialized-view.drop.ts";
import { buildCreateMaterializedViewChanges } from "./objects/materialized-view/materialized-view.diff.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import { CreateCommentOnRlsPolicy } from "./objects/rls-policy/changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./objects/rls-policy/changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./objects/rls-policy/changes/rls-policy.drop.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnSetDefault,
  AlterTableDropColumn,
  AlterTableDropConstraint,
} from "./objects/table/changes/table.alter.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnConstraint,
} from "./objects/table/changes/table.comment.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { GrantTablePrivileges } from "./objects/table/changes/table.privilege.ts";
import { CreateSecurityLabelOnColumn } from "./objects/table/changes/table.security-label.ts";
import { CreateCompositeType } from "./objects/type/composite-type/changes/composite-type.create.ts";
import { DropCompositeType } from "./objects/type/composite-type/changes/composite-type.drop.ts";
import { CreateEnum } from "./objects/type/enum/changes/enum.create.ts";
import { DropEnum } from "./objects/type/enum/changes/enum.drop.ts";
import { CreateRange } from "./objects/type/range/changes/range.create.ts";
import { DropRange } from "./objects/type/range/changes/range.drop.ts";
import { stableId } from "./objects/utils.ts";
import { CreateView } from "./objects/view/changes/view.create.ts";
import { DropView } from "./objects/view/changes/view.drop.ts";
import { buildCreateViewChanges } from "./objects/view/view.diff.ts";

type ResolvedObject =
  | {
      kind: "table";
      main: Catalog["tables"][string];
      branch: Catalog["tables"][string];
    }
  | {
      kind: "view";
      main: Catalog["views"][string];
      branch: Catalog["views"][string];
    }
  | {
      kind: "index";
      main: Catalog["indexes"][string];
      branch: Catalog["indexes"][string];
      branchIndexableObject: Catalog["indexableObjects"][string] | undefined;
    }
  | {
      kind: "materialized_view";
      main: Catalog["materializedViews"][string];
      branch: Catalog["materializedViews"][string];
    }
  | {
      kind: "procedure";
      main: Catalog["procedures"][string];
      branch: Catalog["procedures"][string];
    }
  | {
      kind: "rls_policy";
      main: Catalog["rlsPolicies"][string];
      branch: Catalog["rlsPolicies"][string];
    }
  | {
      kind: "enum";
      main: Catalog["enums"][string];
      branch: Catalog["enums"][string];
    }
  | {
      kind: "range";
      main: Catalog["ranges"][string];
      branch: Catalog["ranges"][string];
    }
  | {
      kind: "composite_type";
      main: Catalog["compositeTypes"][string];
      branch: Catalog["compositeTypes"][string];
    }
  | {
      kind: "domain";
      main: Catalog["domains"][string];
      branch: Catalog["domains"][string];
    };

/**
 * For objects we are replacing (drop + create), ensure that any dependents are also
 * replaced so that destructive drops succeed. Uses dependency edges from pg_depend
 * (already captured in Catalog.depends) plus change metadata (creates/drops/requires).
 *
 * New changes are appended; ordering and any multi-statement cycle normalization
 * are handled later by post-diff helpers and the sorter.
 */
interface ExpandReplaceDependenciesResult {
  changes: Change[];
  replacedTableIds: ReadonlySet<string>;
}

export function expandReplaceDependencies({
  changes,
  mainCatalog,
  branchCatalog,
  diffContext,
}: {
  changes: Change[];
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
}): ExpandReplaceDependenciesResult {
  const createdIds = new Set<string>();
  const droppedIds = new Set<string>();

  for (const change of changes) {
    for (const id of change.creates ?? []) createdIds.add(id);
    for (const id of change.drops ?? []) droppedIds.add(id);
  }

  const replaceRoots = new Set<string>();
  const procedureReplacementRoots = new Set<string>();
  for (const id of createdIds) {
    if (droppedIds.has(id)) {
      replaceRoots.add(id);
      if (id.startsWith("procedure:")) {
        procedureReplacementRoots.add(id);
      }
    }
  }

  const promotedRlsPolicyIds = new Set<string>();
  const additions: Change[] = collectInvalidatedRlsPolicyReplacements({
    changes,
    mainCatalog,
    branchCatalog,
    createdIds,
    droppedIds,
    promotedRlsPolicyIds,
  });

  // Procedure stableIds are signature-qualified
  // (`procedure:schema.name(argtypes)`), so a function whose parameter types
  // change has different ids in `createdIds` and `droppedIds` and would not
  // appear in the intersection above. Treat any dropped procedure whose
  // `(schema, name)` matches a created procedure as a replace root so
  // dependents referencing the old signature via pg_depend get promoted to
  // DROP+CREATE.
  const createdProcedureNames = new Set<string>();
  for (const id of createdIds) {
    const key = parseProcedureSchemaName(id);
    if (key) createdProcedureNames.add(key);
  }
  for (const id of droppedIds) {
    const key = parseProcedureSchemaName(id);
    if (key && createdProcedureNames.has(key)) {
      replaceRoots.add(id);
      procedureReplacementRoots.add(id);
    }
  }

  // Drop-only objects (no matching create — typically a renamed-away table or
  // type) are also expansion roots: anything in main that depends on them via
  // pg_depend must drop before the parent does. Without this seed, a renamed
  // table whose dependent view stays in the branch catalog (with an updated
  // definition that no longer references the old name) would still try to
  // run DROP TABLE old_name while old_name is referenced by the view, which
  // PostgreSQL refuses without CASCADE. The walk below promotes the surviving
  // dependent to DROP+CREATE so its drop is sequenced before the parent drop.
  for (const id of droppedIds) {
    if (createdIds.has(id)) continue;
    if (replaceRoots.has(id)) continue;
    // Only seed for object kinds that can have catalog dependents we know
    // how to recreate via buildReplaceChanges.
    if (
      id.startsWith("table:") ||
      id.startsWith("view:") ||
      id.startsWith("materializedView:") ||
      id.startsWith("type:") ||
      id.startsWith("domain:")
    ) {
      replaceRoots.add(id);
    }
  }

  if (replaceRoots.size === 0 && additions.length === 0) {
    return {
      changes,
      replacedTableIds: new Set<string>(),
    };
  }

  // Build referenced -> dependents adjacency from main catalog dependencies.
  const dependentsByReferenced = new Map<string, Set<string>>();
  for (const dep of mainCatalog.depends) {
    let list = dependentsByReferenced.get(dep.referenced_stable_id);
    if (!list) {
      list = new Set<string>();
      dependentsByReferenced.set(dep.referenced_stable_id, list);
    }
    list.add(dep.dependent_stable_id);
  }

  const visitedTargets = new Set<string>();
  const visitedRefs = new Set<string>(replaceRoots);
  const queue: string[] = [...replaceRoots];
  const expressionDependentCoverage =
    collectExpressionDependentCoverage(changes);
  // Tables being replaced by an expansion-added DropTable+CreateTable pair.
  // Any pre-existing targeted AlterTable*(T) object-scope change is superseded
  // by the replacement and must be removed to avoid contradictions (e.g. an
  // AlterTableDropColumn on a table that is about to be dropped) and the
  // associated drop-phase cycle with the catalog constraint→column edge.
  const tablesReplacedByExpansion = new Set<string>();
  const generatedColumnsRecreatedByExpressionFallback = new Set<string>();

  while (queue.length > 0) {
    const refId = queue.shift() as string;
    const dependents = dependentsByReferenced.get(refId);
    if (!dependents) continue;

    for (const dependentRaw of dependents) {
      if (
        isOwnedSequenceColumnDependency(
          refId,
          dependentRaw,
          mainCatalog,
          branchCatalog,
        )
      ) {
        continue;
      }
      if (
        generatedColumnsRecreatedByExpressionFallback.has(refId) &&
        isMetadataDependentStableId(dependentRaw)
      ) {
        // Column comments and security labels are metadata for the recreated
        // column itself. The drop/add fallback restores them directly, so
        // walking those edges must not promote metadata into object replacement.
        continue;
      }

      if (
        shouldHandleProcedureExpressionDependent({
          refId,
          dependentRaw,
          procedureReplacementRoots,
        })
      ) {
        const releaseCovered =
          expressionDependentCoverage.release.has(dependentRaw);
        const restoreCovered =
          expressionDependentCoverage.restore.has(dependentRaw);
        if (releaseCovered && restoreCovered) {
          continue;
        }

        const expressionReplacementChanges =
          buildExpressionDependentReplacementChanges({
            dependentRaw,
            mainCatalog,
            branchCatalog,
            diffContext,
            createdIds,
            existingChanges: changes,
            addRelease: !releaseCovered,
            addRestore: !restoreCovered,
          });

        if (expressionReplacementChanges !== null) {
          additions.push(...expressionReplacementChanges);
          if (
            recreatesExpressionDependent({
              dependentRaw,
              expressionReplacementChanges,
            })
          ) {
            generatedColumnsRecreatedByExpressionFallback.add(dependentRaw);
          }
          if (!releaseCovered) {
            expressionDependentCoverage.release.add(dependentRaw);
          }
          if (!restoreCovered) {
            expressionDependentCoverage.restore.add(dependentRaw);
          }
          for (const change of expressionReplacementChanges) {
            for (const id of change.creates ?? []) createdIds.add(id);
            for (const id of change.drops ?? []) droppedIds.add(id);
          }
          if (
            shouldTraverseExpressionReplacementDependent({
              dependentRaw,
              expressionReplacementChanges,
            })
          ) {
            queueRefForTraversal(dependentRaw, visitedRefs, queue);
          }
          continue;
        }
      }

      if (
        maybeAddColumnDependentConstraintReplacement({
          refId,
          dependentRaw,
          mainCatalog,
          branchCatalog,
          additions,
          createdIds,
          droppedIds,
          visitedTargets,
        })
      ) {
        continue;
      }

      const targetId = normalizeDependentId(
        dependentRaw,
        mainCatalog,
        branchCatalog,
      );
      if (
        targetId &&
        shouldSuppressCoveredExpressionDependent({
          refId,
          dependentRaw,
          expressionDependentCoverage,
          procedureReplacementRoots,
        })
      ) {
        continue;
      }

      // Continue traversing the dependency graph from the raw dependent id.
      if (!visitedRefs.has(dependentRaw)) {
        visitedRefs.add(dependentRaw);
        queue.push(dependentRaw);
      }

      if (!targetId) continue;

      // Also traverse using the normalized owning object id (e.g., table for a column).
      if (!visitedRefs.has(targetId)) {
        visitedRefs.add(targetId);
        queue.push(targetId);
      }

      if (visitedTargets.has(targetId)) continue;
      visitedTargets.add(targetId);

      // Already handled (either original replace or previously added).
      if (createdIds.has(targetId) && droppedIds.has(targetId)) continue;
      if (replaceRoots.has(targetId)) continue;

      const resolved = resolveObjectForStableId(
        targetId,
        mainCatalog,
        branchCatalog,
      );
      if (!resolved) continue;

      const hasCreate = createdIds.has(targetId);
      const hasDrop = droppedIds.has(targetId);

      const addDrop = !hasDrop;
      const addCreate = !hasCreate;

      if (!addDrop && !addCreate) continue;

      const replacementChanges = buildReplaceChanges(resolved, {
        addDrop,
        addCreate,
        diffContext,
      });
      if (!replacementChanges) continue;

      additions.push(...replacementChanges);
      if (resolved.kind === "rls_policy") {
        promotedRlsPolicyIds.add(targetId);
      }

      // If we added a DropTable(T) for an existing table, mark T so any
      // pre-existing object-scope AlterTable*(T) changes get dropped below —
      // the DropTable+CreateTable pair supersedes all structural alterations.
      if (resolved.kind === "table" && addDrop) {
        tablesReplacedByExpansion.add(targetId);
      }

      // Track new creates/drops so we don't duplicate work for downstream dependents.
      for (const change of replacementChanges) {
        for (const id of change.creates ?? []) createdIds.add(id);
        for (const id of change.drops ?? []) droppedIds.add(id);
      }
    }
  }

  if (additions.length === 0) {
    return {
      changes,
      replacedTableIds: tablesReplacedByExpansion,
    };
  }

  return {
    changes: [
      ...removeSupersededGeneratedColumnSetExpressions(
        removeSupersededRlsPolicyAlters(changes, promotedRlsPolicyIds),
        generatedColumnsRecreatedByExpressionFallback,
      ),
      ...additions,
    ],
    replacedTableIds: tablesReplacedByExpansion,
  };
}

function queueRefForTraversal(
  refId: string,
  visitedRefs: Set<string>,
  queue: string[],
) {
  if (visitedRefs.has(refId)) return;
  visitedRefs.add(refId);
  queue.push(refId);
}

function collectInvalidatedRlsPolicyReplacements({
  changes,
  mainCatalog,
  branchCatalog,
  createdIds,
  droppedIds,
  promotedRlsPolicyIds,
}: {
  changes: Change[];
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  createdIds: Set<string>;
  droppedIds: Set<string>;
  promotedRlsPolicyIds: Set<string>;
}): Change[] {
  // In-place rewrites report stable ids through `invalidates`: the referenced
  // object keeps its identity, but dependents bound to the old definition must
  // be torn down first. RLS policy expressions are tracked in pg_depend, so use
  // those catalog edges to promote only policies that depend on an invalidated
  // id, without coupling this expansion pass to a concrete table-change class.
  const invalidatedIds = new Set<string>();
  for (const change of changes) {
    for (const invalidatedId of change.invalidates) {
      invalidatedIds.add(invalidatedId);
    }
  }
  if (invalidatedIds.size === 0) return [];

  const replacements: Change[] = [];
  for (const dep of mainCatalog.depends) {
    if (!invalidatedIds.has(dep.referenced_stable_id)) continue;

    const targetId = normalizeDependentId(
      dep.dependent_stable_id,
      mainCatalog,
      branchCatalog,
    );
    if (!targetId?.startsWith("rlsPolicy:")) continue;
    if (promotedRlsPolicyIds.has(targetId)) continue;
    if (createdIds.has(targetId) && droppedIds.has(targetId)) continue;

    const resolved = resolveObjectForStableId(
      targetId,
      mainCatalog,
      branchCatalog,
    );
    if (!resolved || resolved.kind !== "rls_policy") continue;

    const addDrop = !droppedIds.has(targetId);
    const addCreate = !createdIds.has(targetId);
    const replacementChanges = buildReplaceChanges(resolved, {
      addDrop,
      addCreate,
    });
    if (!replacementChanges) continue;

    replacements.push(...replacementChanges);
    promotedRlsPolicyIds.add(targetId);
    for (const change of replacementChanges) {
      for (const id of change.creates ?? []) createdIds.add(id);
      for (const id of change.drops ?? []) droppedIds.add(id);
    }
  }

  return replacements;
}

function removeSupersededRlsPolicyAlters(
  changes: Change[],
  promotedRlsPolicyIds: ReadonlySet<string>,
): Change[] {
  if (promotedRlsPolicyIds.size === 0) return changes;
  return changes.filter((change) => {
    if (change.objectType !== "rls_policy" || change.operation !== "alter") {
      return true;
    }
    return !promotedRlsPolicyIds.has(change.policy.stableId);
  });
}

interface ExpressionDependentCoverage {
  release: Set<string>;
  restore: Set<string>;
}

function collectExpressionDependentCoverage(
  changes: Change[],
): ExpressionDependentCoverage {
  const release = new Set<string>();
  const restore = new Set<string>();

  for (const change of changes) {
    for (const id of change.creates ?? []) {
      if (isExpressionContainerStableId(id)) {
        restore.add(id);
      }
    }

    for (const id of change.drops ?? []) {
      if (isExpressionContainerStableId(id)) {
        release.add(id);
      }
    }

    if (
      change instanceof AlterTableAlterColumnDropDefault ||
      change instanceof AlterTableDropConstraint ||
      change instanceof AlterDomainDropDefault
    ) {
      for (const id of change.requires ?? []) {
        if (isExpressionContainerStableId(id)) {
          release.add(id);
        }
      }
    }

    if (
      change instanceof AlterTableAddConstraint ||
      change instanceof AlterDomainSetDefault ||
      change instanceof AlterDomainAddConstraint
    ) {
      for (const id of change.requires ?? []) {
        if (isExpressionContainerStableId(id)) {
          restore.add(id);
        }
      }
    }

    if (change instanceof AlterTableAlterColumnSetDefault) {
      for (const id of change.requires ?? []) {
        if (isExpressionContainerStableId(id)) {
          // SET EXPRESSION installs the branch expression in the create/alter
          // phase; it does not release the old pg_depend edge before DROP
          // FUNCTION runs, so generated columns still need a drop-phase
          // fallback when a replaced procedure keeps the same stable id.
          restore.add(id);
        }
      }
    }
  }

  return { release, restore };
}

function shouldSuppressCoveredExpressionDependent({
  refId,
  dependentRaw,
  expressionDependentCoverage,
  procedureReplacementRoots,
}: {
  refId: string;
  dependentRaw: string;
  expressionDependentCoverage: {
    release: ReadonlySet<string>;
    restore: ReadonlySet<string>;
  };
  procedureReplacementRoots: ReadonlySet<string>;
}): boolean {
  // Procedure replacement can require expression containers to release their
  // pg_depend edge before the old routine is dropped. When the original diff
  // already emitted that targeted expression change, promoting the normalized
  // table/domain owner to DROP+CREATE would be redundant and destructive.
  return (
    procedureReplacementRoots.has(refId) &&
    isExpressionContainerStableId(dependentRaw) &&
    expressionDependentCoverage.release.has(dependentRaw) &&
    expressionDependentCoverage.restore.has(dependentRaw)
  );
}

function shouldHandleProcedureExpressionDependent({
  refId,
  dependentRaw,
  procedureReplacementRoots,
}: {
  refId: string;
  dependentRaw: string;
  procedureReplacementRoots: ReadonlySet<string>;
}): boolean {
  return (
    procedureReplacementRoots.has(refId) &&
    isExpressionContainerStableId(dependentRaw)
  );
}

function isExpressionContainerStableId(stableId: string): boolean {
  return (
    stableId.startsWith("column:") ||
    stableId.startsWith("constraint:") ||
    stableId.startsWith("domain:")
  );
}

function isMetadataDependentStableId(stableId: string): boolean {
  return (
    stableId.startsWith("comment:") || stableId.startsWith("securityLabel:")
  );
}

function shouldTraverseExpressionReplacementDependent({
  dependentRaw,
  expressionReplacementChanges,
}: {
  dependentRaw: string;
  expressionReplacementChanges: Change[];
}): boolean {
  // Some targeted expression fallbacks are themselves destructive. Recreating a
  // generated column releases the procedure dependency but also removes or
  // blocks objects that depend on that column, so keep walking from the raw id.
  return expressionReplacementChanges.some((change) =>
    change.drops?.some((id) => id === dependentRaw),
  );
}

function recreatesExpressionDependent({
  dependentRaw,
  expressionReplacementChanges,
}: {
  dependentRaw: string;
  expressionReplacementChanges: Change[];
}): boolean {
  let dropsDependent = false;
  let createsDependent = false;
  for (const change of expressionReplacementChanges) {
    dropsDependent ||= change.drops?.some((id) => id === dependentRaw) ?? false;
    createsDependent ||=
      change.creates?.some((id) => id === dependentRaw) ?? false;
  }
  return dropsDependent && createsDependent;
}

function removeSupersededGeneratedColumnSetExpressions(
  changes: Change[],
  recreatedColumnIds: ReadonlySet<string>,
): Change[] {
  if (recreatedColumnIds.size === 0) return changes;

  return changes.filter((change) => {
    if (!(change instanceof AlterTableAlterColumnSetDefault)) return true;
    if (!change.column.is_generated) return true;

    const columnId = stableId.column(
      change.table.schema,
      change.table.name,
      change.column.name,
    );
    return !recreatedColumnIds.has(columnId);
  });
}

function buildExpressionDependentReplacementChanges({
  dependentRaw,
  mainCatalog,
  branchCatalog,
  diffContext,
  createdIds,
  existingChanges,
  addRelease,
  addRestore,
}: {
  dependentRaw: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
  createdIds: ReadonlySet<string>;
  existingChanges: readonly Change[];
  addRelease: boolean;
  addRestore: boolean;
}): Change[] | null {
  if (dependentRaw.startsWith("column:")) {
    return buildColumnExpressionReplacementChanges({
      dependentRaw,
      mainCatalog,
      branchCatalog,
      diffContext,
      createdIds,
      existingChanges,
      addRelease,
      addRestore,
    });
  }

  if (dependentRaw.startsWith("domain:")) {
    return buildDomainDefaultReplacementChanges({
      dependentRaw,
      mainCatalog,
      branchCatalog,
      addRelease,
      addRestore,
    });
  }

  if (dependentRaw.startsWith("constraint:")) {
    return buildConstraintExpressionReplacementChanges({
      dependentRaw,
      mainCatalog,
      branchCatalog,
      addRelease,
      addRestore,
    });
  }

  return null;
}

function maybeAddColumnDependentConstraintReplacement({
  refId,
  dependentRaw,
  mainCatalog,
  branchCatalog,
  additions,
  createdIds,
  droppedIds,
  visitedTargets,
}: {
  refId: string;
  dependentRaw: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  additions: Change[];
  createdIds: Set<string>;
  droppedIds: Set<string>;
  visitedTargets: Set<string>;
}): boolean {
  if (!refId.startsWith("column:") || !dependentRaw.startsWith("constraint:")) {
    return false;
  }
  if (visitedTargets.has(dependentRaw)) return true;

  const addRelease = !droppedIds.has(dependentRaw);
  const addRestore = !createdIds.has(dependentRaw);
  if (!addRelease && !addRestore) return true;

  const constraintReplacementChanges =
    buildConstraintExpressionReplacementChanges({
      dependentRaw,
      mainCatalog,
      branchCatalog,
      addRelease,
      addRestore,
    });
  if (!constraintReplacementChanges) return false;

  additions.push(...constraintReplacementChanges);
  visitedTargets.add(dependentRaw);
  for (const change of constraintReplacementChanges) {
    for (const id of change.creates ?? []) createdIds.add(id);
    for (const id of change.drops ?? []) droppedIds.add(id);
  }
  return true;
}

function buildColumnExpressionReplacementChanges({
  dependentRaw,
  mainCatalog,
  branchCatalog,
  diffContext,
  createdIds,
  existingChanges,
  addRelease,
  addRestore,
}: {
  dependentRaw: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
  createdIds: ReadonlySet<string>;
  existingChanges: readonly Change[];
  addRelease: boolean;
  addRestore: boolean;
}): Change[] | null {
  const columnRef = parseColumnStableId(dependentRaw);
  if (!columnRef) return null;

  const tableId = stableId.table(columnRef.schema, columnRef.table);
  const mainTable = mainCatalog.tables[tableId];
  const branchTable = branchCatalog.tables[tableId];
  if (!mainTable || !branchTable) return null;
  // Partition child column DDL is propagated from the parent table. Treating the
  // child pg_depend row as covered avoids emitting duplicate child ALTER TABLE.
  if (mainTable.is_partition || branchTable.is_partition) {
    return [];
  }

  const mainColumn = mainTable.columns.find(
    (column) => column.name === columnRef.column,
  );
  if (!mainColumn || mainColumn.default === null) return null;

  const branchColumn = branchTable.columns.find(
    (column) => column.name === columnRef.column,
  );
  if (!branchColumn) {
    // The branch removed this column. When the original diff already drops it,
    // that drop releases the pg_depend edge and there is no expression to
    // restore, so this dependent is handled without owner table replacement.
    return addRelease
      ? [new AlterTableDropColumn({ table: mainTable, column: mainColumn })]
      : [];
  }

  const generatedColumnInvolved =
    mainColumn.is_generated || branchColumn.is_generated;
  if (generatedColumnInvolved) {
    const canRecreateGeneratedColumn =
      mainColumn.is_generated &&
      branchColumn.is_generated &&
      branchColumn.default !== null;

    if (addRelease && canRecreateGeneratedColumn) {
      const commentRestoreCovered = createdIds.has(
        stableId.comment(dependentRaw),
      );
      // DROP DEFAULT is invalid for generated columns, while DROP EXPRESSION
      // turns the column into a regular column that SET EXPRESSION cannot
      // restore. Recreating the column releases the dependency without relying
      // on PostgreSQL 17's SET EXPRESSION support.
      return [
        new AlterTableDropColumn({
          table: mainTable,
          column: mainColumn,
        }),
        new AlterTableAddColumn({
          table: branchTable,
          column: branchColumn,
        }),
        ...(branchColumn.comment !== null && !commentRestoreCovered
          ? [
              new CreateCommentOnColumn({
                table: branchTable,
                column: branchColumn,
              }),
            ]
          : []),
        ...(branchColumn.security_labels ?? [])
          .filter(
            (securityLabel) =>
              !createdIds.has(
                stableId.securityLabel(dependentRaw, securityLabel.provider),
              ),
          )
          .map(
            (securityLabel) =>
              new CreateSecurityLabelOnColumn({
                table: branchTable,
                column: branchColumn,
                securityLabel,
              }),
          ),
        // Column ACLs are stored on the dropped attribute. Unchanged grants do
        // not appear in the normal diff, so the fallback must replay them.
        ...buildRetainedColumnGrantChanges({
          table: branchTable,
          columnName: branchColumn.name,
          existingChanges,
          diffContext,
        }),
      ];
    }

    // PostgreSQL only gained ALTER COLUMN ... SET EXPRESSION for generated
    // columns in v17. Switching generated status still needs the existing
    // destructive column/table fallback because SET EXPRESSION applies only
    // to an already-generated column.
    if (
      (diffContext?.version ?? 0) < 170000 ||
      mainColumn.is_generated !== branchColumn.is_generated ||
      !branchColumn.is_generated ||
      branchColumn.default === null
    ) {
      return null;
    }

    return addRestore
      ? [
          new AlterTableAlterColumnSetDefault({
            table: branchTable,
            column: branchColumn,
          }),
        ]
      : [];
  }

  const changes: Change[] = [];

  if (addRelease) {
    changes.push(
      new AlterTableAlterColumnDropDefault({
        table: mainTable,
        column: mainColumn,
      }),
    );
  }

  if (addRestore && branchColumn.default !== null) {
    changes.push(
      new AlterTableAlterColumnSetDefault({
        table: branchTable,
        column: branchColumn,
      }),
    );
  }

  return changes;
}

function buildDomainDefaultReplacementChanges({
  dependentRaw,
  mainCatalog,
  branchCatalog,
  addRelease,
  addRestore,
}: {
  dependentRaw: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  addRelease: boolean;
  addRestore: boolean;
}): Change[] | null {
  const mainDomain = mainCatalog.domains[dependentRaw];
  const branchDomain = branchCatalog.domains[dependentRaw];
  if (!mainDomain || !branchDomain || mainDomain.default_value === null) {
    return null;
  }

  const changes: Change[] = [];
  if (addRelease) {
    changes.push(new AlterDomainDropDefault({ domain: mainDomain }));
  }
  if (addRestore && branchDomain.default_value !== null) {
    changes.push(
      new AlterDomainSetDefault({
        domain: branchDomain,
        defaultValue: branchDomain.default_value,
      }),
    );
  }

  return changes;
}

function buildRetainedColumnGrantChanges({
  table,
  columnName,
  existingChanges,
  diffContext,
}: {
  table: Catalog["tables"][string];
  columnName: string;
  existingChanges: readonly Change[];
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
}): Change[] {
  const grantsByKey = new Map<
    string,
    {
      grantee: string;
      grantable: boolean;
      privileges: Set<string>;
    }
  >();

  for (const privilege of table.privileges) {
    if (!privilege.columns?.includes(columnName)) continue;
    if (privilege.grantee === table.owner) continue;
    if (
      isColumnGrantCovered({
        existingChanges,
        tableStableId: table.stableId,
        grantee: privilege.grantee,
        columnName,
        privilege: privilege.privilege,
        grantable: privilege.grantable,
      })
    ) {
      continue;
    }

    const key = `${privilege.grantee}\0${privilege.grantable}`;
    const group = grantsByKey.get(key) ?? {
      grantee: privilege.grantee,
      grantable: privilege.grantable,
      privileges: new Set<string>(),
    };
    group.privileges.add(privilege.privilege);
    grantsByKey.set(key, group);
  }

  return [...grantsByKey.values()].map(
    (group) =>
      new GrantTablePrivileges({
        table,
        grantee: group.grantee,
        privileges: [...group.privileges].map((privilege) => ({
          privilege,
          grantable: group.grantable,
        })),
        columns: [columnName],
        version: diffContext?.version,
      }),
  );
}

function isColumnGrantCovered({
  existingChanges,
  tableStableId,
  grantee,
  columnName,
  privilege,
  grantable,
}: {
  existingChanges: readonly Change[];
  tableStableId: string;
  grantee: string;
  columnName: string;
  privilege: string;
  grantable: boolean;
}): boolean {
  return existingChanges.some(
    (change) =>
      change instanceof GrantTablePrivileges &&
      change.table.stableId === tableStableId &&
      change.grantee === grantee &&
      change.columns?.includes(columnName) === true &&
      change.privileges.some(
        (grantedPrivilege) =>
          grantedPrivilege.privilege === privilege &&
          grantedPrivilege.grantable === grantable,
      ),
  );
}

function buildConstraintExpressionReplacementChanges({
  dependentRaw,
  mainCatalog,
  branchCatalog,
  addRelease,
  addRestore,
}: {
  dependentRaw: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  addRelease: boolean;
  addRestore: boolean;
}): Change[] | null {
  const constraintRef = parseConstraintStableId(dependentRaw);
  if (!constraintRef) return null;

  const domainChanges = buildDomainConstraintReplacementChanges({
    constraintRef,
    mainCatalog,
    branchCatalog,
    addRelease,
    addRestore,
  });
  if (domainChanges) return domainChanges;

  return buildTableConstraintReplacementChanges({
    constraintRef,
    mainCatalog,
    branchCatalog,
    addRelease,
    addRestore,
  });
}

function buildDomainConstraintReplacementChanges({
  constraintRef,
  mainCatalog,
  branchCatalog,
  addRelease,
  addRestore,
}: {
  constraintRef: ConstraintStableIdParts;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  addRelease: boolean;
  addRestore: boolean;
}): Change[] | null {
  const domainId = `domain:${constraintRef.schema}.${constraintRef.owner}`;
  const mainDomain = mainCatalog.domains[domainId];
  const branchDomain = branchCatalog.domains[domainId];

  if (!mainDomain || !branchDomain) {
    return null;
  }

  const mainConstraint = mainDomain.constraints.find(
    (constraint) => constraint.name === constraintRef.constraint,
  );
  const branchConstraint = branchDomain.constraints.find(
    (constraint) => constraint.name === constraintRef.constraint,
  );
  if (!mainConstraint) return null;

  const changes: Change[] = [];
  if (addRelease) {
    changes.push(
      new AlterDomainDropConstraint({
        domain: mainDomain,
        constraint: mainConstraint,
      }),
    );
  }

  if (addRestore) {
    if (!branchConstraint) return changes;
    changes.push(
      new AlterDomainAddConstraint({
        domain: branchDomain,
        constraint: branchConstraint,
      }),
    );
  }

  return changes;
}

function buildTableConstraintReplacementChanges({
  constraintRef,
  mainCatalog,
  branchCatalog,
  addRelease,
  addRestore,
}: {
  constraintRef: ConstraintStableIdParts;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  addRelease: boolean;
  addRestore: boolean;
}): Change[] | null {
  const tableId = stableId.table(constraintRef.schema, constraintRef.owner);
  const mainTable = mainCatalog.tables[tableId];
  const branchTable = branchCatalog.tables[tableId];
  if (!mainTable || !branchTable) return null;

  const mainConstraint = mainTable.constraints.find(
    (constraint) => constraint.name === constraintRef.constraint,
  );
  const branchConstraint = branchTable.constraints.find(
    (constraint) => constraint.name === constraintRef.constraint,
  );
  if (!mainConstraint) return null;
  // PostgreSQL clones parent CHECK constraints onto partitions. The parent
  // constraint replacement releases/restores the dependency for all children.
  if (
    mainConstraint.is_partition_clone ||
    branchConstraint?.is_partition_clone
  ) {
    return [];
  }

  const changes: Change[] = [];
  if (addRelease) {
    changes.push(
      new AlterTableDropConstraint({
        table: mainTable,
        constraint: mainConstraint,
      }),
    );
  }

  if (addRestore) {
    if (!branchConstraint) return changes;
    changes.push(
      new AlterTableAddConstraint({
        table: branchTable,
        constraint: branchConstraint,
      }),
    );
    if (branchConstraint.comment !== null) {
      changes.push(
        new CreateCommentOnConstraint({
          table: branchTable,
          constraint: branchConstraint,
        }),
      );
    }
  }

  return changes;
}

function isOwnedSequenceColumnDependency(
  referencedId: string,
  dependentId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
): boolean {
  // When a sequence replace root is still OWNED BY the same column, the
  // sequence->column pg_depend edge is bookkeeping for ownership, not a signal
  // that the whole owning table needs to be replaced. Skipping that edge keeps
  // expandReplaceDependencies focused on recreating the sequence itself.
  if (
    !referencedId.startsWith("sequence:") ||
    !dependentId.startsWith("column:")
  ) {
    return false;
  }

  const sequence =
    branchCatalog.sequences[referencedId] ??
    mainCatalog.sequences[referencedId];
  if (
    !sequence?.owned_by_schema ||
    !sequence.owned_by_table ||
    !sequence.owned_by_column
  ) {
    return false;
  }

  return (
    dependentId ===
    stableId.column(
      sequence.owned_by_schema,
      sequence.owned_by_table,
      sequence.owned_by_column,
    )
  );
}

function parseProcedureSchemaName(stableId: string): string | null {
  if (!stableId.startsWith("procedure:")) return null;
  const paren = stableId.indexOf("(");
  if (paren === -1) return null;
  return stableId.slice("procedure:".length, paren);
}

function normalizeDependentId(
  dependentId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
): string | null {
  let id = dependentId;

  while (id.startsWith("comment:")) {
    id = id.slice("comment:".length);
  }

  if (
    id.startsWith("acl:") ||
    id.startsWith("defacl:") ||
    id.startsWith("membership:") ||
    id.startsWith("role:") ||
    id.startsWith("schema:")
  ) {
    return null;
  }

  if (id.startsWith("column:")) {
    const parts = id.slice("column:".length).split(".");
    if (parts.length >= 2) {
      const [schema, table] = parts;
      return `table:${schema}.${table}`;
    }
    return null;
  }

  if (id.startsWith("constraint:")) {
    const constraintRef = parseConstraintStableId(id);
    if (constraintRef) {
      const domainId = `domain:${constraintRef.schema}.${constraintRef.owner}`;
      if (
        mainCatalog.domains[domainId] !== undefined ||
        branchCatalog.domains[domainId] !== undefined
      ) {
        return domainId;
      }
      return stableId.table(constraintRef.schema, constraintRef.owner);
    }
    return null;
  }

  return id;
}

interface ColumnStableIdParts {
  schema: string;
  table: string;
  column: string;
}

interface ConstraintStableIdParts {
  schema: string;
  owner: string;
  constraint: string;
}

function parseColumnStableId(stableId: string): ColumnStableIdParts | null {
  if (!stableId.startsWith("column:")) return null;
  const parts = stableId.slice("column:".length).split(".");
  if (parts.length < 3) return null;
  const [schema, table, ...columnParts] = parts;
  return {
    schema,
    table,
    column: columnParts.join("."),
  };
}

function parseConstraintStableId(
  stableId: string,
): ConstraintStableIdParts | null {
  if (!stableId.startsWith("constraint:")) return null;
  const parts = stableId.slice("constraint:".length).split(".");
  if (parts.length < 3) return null;
  const [schema, owner, ...constraintParts] = parts;
  return {
    schema,
    owner,
    constraint: constraintParts.join("."),
  };
}

function resolveObjectForStableId(
  stableId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
): ResolvedObject | null {
  if (stableId.startsWith("table:")) {
    const main = mainCatalog.tables[stableId];
    const branch = branchCatalog.tables[stableId];
    return main && branch ? { kind: "table", main, branch } : null;
  }

  if (stableId.startsWith("view:")) {
    const main = mainCatalog.views[stableId];
    const branch = branchCatalog.views[stableId];
    return main && branch ? { kind: "view", main, branch } : null;
  }

  if (stableId.startsWith("materializedView:")) {
    const main = mainCatalog.materializedViews[stableId];
    const branch = branchCatalog.materializedViews[stableId];
    return main && branch ? { kind: "materialized_view", main, branch } : null;
  }

  if (stableId.startsWith("index:")) {
    const main = mainCatalog.indexes[stableId];
    const branch = branchCatalog.indexes[stableId];
    return main && branch
      ? {
          kind: "index",
          main,
          branch,
          branchIndexableObject:
            branchCatalog.indexableObjects[branch.tableStableId],
        }
      : null;
  }

  if (stableId.startsWith("procedure:")) {
    const main = mainCatalog.procedures[stableId];
    const branch = branchCatalog.procedures[stableId];
    return main && branch ? { kind: "procedure", main, branch } : null;
  }

  if (stableId.startsWith("rlsPolicy:")) {
    const main = mainCatalog.rlsPolicies[stableId];
    const branch = branchCatalog.rlsPolicies[stableId];
    return main && branch ? { kind: "rls_policy", main, branch } : null;
  }

  if (stableId.startsWith("domain:")) {
    const main = mainCatalog.domains[stableId];
    const branch = branchCatalog.domains[stableId];
    return main && branch ? { kind: "domain", main, branch } : null;
  }

  if (stableId.startsWith("type:")) {
    const enumMain = mainCatalog.enums[stableId];
    const enumBranch = branchCatalog.enums[stableId];
    if (enumMain && enumBranch) {
      return { kind: "enum", main: enumMain, branch: enumBranch };
    }

    const rangeMain = mainCatalog.ranges[stableId];
    const rangeBranch = branchCatalog.ranges[stableId];
    if (rangeMain && rangeBranch) {
      return { kind: "range", main: rangeMain, branch: rangeBranch };
    }

    const compositeMain = mainCatalog.compositeTypes[stableId];
    const compositeBranch = branchCatalog.compositeTypes[stableId];
    if (compositeMain && compositeBranch) {
      return {
        kind: "composite_type",
        main: compositeMain,
        branch: compositeBranch,
      };
    }
  }

  return null;
}

function buildReplaceChanges(
  resolved: ResolvedObject,
  options: {
    addDrop: boolean;
    addCreate: boolean;
    diffContext?: Pick<
      ObjectDiffContext,
      "version" | "currentUser" | "defaultPrivilegeState"
    >;
  },
): Change[] | null {
  const { addDrop, addCreate, diffContext } = options;

  if (!addDrop && !addCreate) return null;

  switch (resolved.kind) {
    case "table":
      return [
        ...(addDrop ? [new DropTable({ table: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateTable({ table: resolved.branch }),
              ...((resolved.branch.constraints ?? [])
                .filter((c) => !c.is_partition_clone)
                .flatMap((constraint) => {
                  const items: Change[] = [
                    new AlterTableAddConstraint({
                      table: resolved.branch,
                      constraint,
                    }),
                  ];
                  if (
                    constraint.comment !== null &&
                    constraint.comment !== undefined
                  ) {
                    items.push(
                      new CreateCommentOnConstraint({
                        table: resolved.branch,
                        constraint,
                      }),
                    );
                  }
                  return items;
                }) as Change[]),
            ]
          : []),
      ];
    case "view":
      return [
        ...(addDrop ? [new DropView({ view: resolved.main })] : []),
        ...(addCreate
          ? buildCreateViewReplacementChanges(resolved.branch, diffContext)
          : []),
      ];
    case "materialized_view":
      return [
        ...(addDrop
          ? [new DropMaterializedView({ materializedView: resolved.main })]
          : []),
        ...(addCreate
          ? diffContext
            ? buildCreateMaterializedViewChanges(diffContext, resolved.branch)
            : [
                new CreateMaterializedView({
                  materializedView: resolved.branch,
                }),
              ]
          : []),
      ];
    case "index":
      // Constraint-owned, primary, and partition-attached indexes are managed
      // by the owning constraint or parent-index DDL, not standalone
      // CREATE INDEX / DROP INDEX. The `case "table":` branch above already
      // recreates constraints via AlterTableAddConstraint; emitting a
      // standalone drop/create here would fail in PostgreSQL
      // ("cannot drop index ... because constraint ... requires it") or
      // duplicate the index the constraint recreates. Skip matches
      // diffIndexes (packages/pg-delta/src/core/objects/index/index.diff.ts).
      if (
        resolved.main.is_owned_by_constraint ||
        resolved.main.is_primary ||
        resolved.main.is_index_partition ||
        resolved.branch.is_owned_by_constraint ||
        resolved.branch.is_primary ||
        resolved.branch.is_index_partition
      ) {
        return null;
      }
      return [
        ...(addDrop ? [new DropIndex({ index: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateIndex({
                index: resolved.branch,
                indexableObject: resolved.branchIndexableObject,
              }),
              ...(resolved.branch.comment !== null
                ? [new CreateCommentOnIndex({ index: resolved.branch })]
                : []),
              // CREATE INDEX does not carry expression-index statistics, so
              // replay retained targets after the replacement index exists.
              ...buildRetainedIndexStatisticsChanges(resolved.branch),
            ]
          : []),
      ];
    case "procedure":
      return [
        ...(addDrop ? [new DropProcedure({ procedure: resolved.main })] : []),
        ...(addCreate
          ? [new CreateProcedure({ procedure: resolved.branch })]
          : []),
      ];
    case "rls_policy":
      return [
        ...(addDrop ? [new DropRlsPolicy({ policy: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateRlsPolicy({ policy: resolved.branch }),
              ...(resolved.branch.comment !== null
                ? [new CreateCommentOnRlsPolicy({ policy: resolved.branch })]
                : []),
            ]
          : []),
      ];
    case "enum":
      return [
        ...(addDrop ? [new DropEnum({ enum: resolved.main })] : []),
        ...(addCreate ? [new CreateEnum({ enum: resolved.branch })] : []),
      ];
    case "range":
      return [
        ...(addDrop ? [new DropRange({ range: resolved.main })] : []),
        ...(addCreate ? [new CreateRange({ range: resolved.branch })] : []),
      ];
    case "composite_type":
      return [
        ...(addDrop
          ? [new DropCompositeType({ compositeType: resolved.main })]
          : []),
        ...(addCreate
          ? [new CreateCompositeType({ compositeType: resolved.branch })]
          : []),
      ];
    case "domain":
      return [
        ...(addDrop ? [new DropDomain({ domain: resolved.main })] : []),
        ...(addCreate ? [new CreateDomain({ domain: resolved.branch })] : []),
      ];
    default:
      return null;
  }
}

function buildRetainedIndexStatisticsChanges(
  index: Catalog["indexes"][string],
): Change[] {
  const columnTargets = index.statistics_target
    .map((statistics, index) => ({
      columnNumber: index + 1,
      statistics,
    }))
    .filter(({ statistics }) => statistics >= 0);

  return columnTargets.length > 0
    ? [new AlterIndexSetStatistics({ index, columnTargets })]
    : [];
}

function buildCreateViewReplacementChanges(
  view: Catalog["views"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
): Change[] {
  // Dependency-closure replacements synthesize a create without going through
  // `diffViews`, so replay the same owner/comment/security-label/ACL metadata
  // that a normal non-alterable view replacement would emit.
  return diffContext
    ? buildCreateViewChanges(diffContext, view)
    : [new CreateView({ view })];
}
