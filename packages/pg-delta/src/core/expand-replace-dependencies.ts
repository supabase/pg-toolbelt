import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
  filterPublicBuiltInDefaults,
} from "./objects/base.privilege-diff.ts";
import type { ObjectDiffContext } from "./objects/diff-context.ts";
import { AlterAggregateChangeOwner } from "./objects/aggregate/changes/aggregate.alter.ts";
import { CreateCommentOnAggregate } from "./objects/aggregate/changes/aggregate.comment.ts";
import { CreateAggregate } from "./objects/aggregate/changes/aggregate.create.ts";
import { DropAggregate } from "./objects/aggregate/changes/aggregate.drop.ts";
import {
  GrantAggregatePrivileges,
  RevokeAggregatePrivileges,
  RevokeGrantOptionAggregatePrivileges,
} from "./objects/aggregate/changes/aggregate.privilege.ts";
import { CreateSecurityLabelOnAggregate } from "./objects/aggregate/changes/aggregate.security-label.ts";
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
import { AlterMaterializedViewClusterOn } from "./objects/materialized-view/changes/materialized-view.alter.ts";
import { CreateMaterializedView } from "./objects/materialized-view/changes/materialized-view.create.ts";
import { DropMaterializedView } from "./objects/materialized-view/changes/materialized-view.drop.ts";
import { buildCreateMaterializedViewChanges } from "./objects/materialized-view/materialized-view.diff.ts";
import { AlterProcedureChangeOwner } from "./objects/procedure/changes/procedure.alter.ts";
import { CreateCommentOnProcedure } from "./objects/procedure/changes/procedure.comment.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import {
  GrantProcedurePrivileges,
  RevokeGrantOptionProcedurePrivileges,
  RevokeProcedurePrivileges,
} from "./objects/procedure/changes/procedure.privilege.ts";
import { CreateSecurityLabelOnProcedure } from "./objects/procedure/changes/procedure.security-label.ts";
import {
  AlterPublicationAddTables,
  AlterPublicationDropTables,
} from "./objects/publication/changes/publication.alter.ts";
import type { PublicationTableProps } from "./objects/publication/publication.model.ts";
import { CreateCommentOnRlsPolicy } from "./objects/rls-policy/changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./objects/rls-policy/changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./objects/rls-policy/changes/rls-policy.drop.ts";
import { CreateCommentOnRule } from "./objects/rule/changes/rule.comment.ts";
import { CreateRule } from "./objects/rule/changes/rule.create.ts";
import { DropRule } from "./objects/rule/changes/rule.drop.ts";
import { SetRuleEnabledState } from "./objects/rule/changes/rule.alter.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnSetDefault,
  AlterTableClusterOn,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableSetReplicaIdentity,
} from "./objects/table/changes/table.alter.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnConstraint,
} from "./objects/table/changes/table.comment.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { GrantTablePrivileges } from "./objects/table/changes/table.privilege.ts";
import { CreateSecurityLabelOnColumn } from "./objects/table/changes/table.security-label.ts";
import type { TableProps } from "./objects/table/table.model.ts";
import { SetTriggerEnabledState } from "./objects/trigger/changes/trigger.alter.ts";
import { CreateCommentOnTrigger } from "./objects/trigger/changes/trigger.comment.ts";
import { CreateTrigger } from "./objects/trigger/changes/trigger.create.ts";
import { DropTrigger } from "./objects/trigger/changes/trigger.drop.ts";
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
      branchMaterializedView: Catalog["materializedViews"][string] | undefined;
      branchTable: Catalog["tables"][string] | undefined;
    }
  | {
      kind: "trigger";
      main: Catalog["triggers"][string];
      branch: Catalog["triggers"][string];
      branchIndexableObject: Catalog["indexableObjects"][string] | undefined;
    }
  | {
      kind: "rule";
      main: Catalog["rules"][string];
      branch: Catalog["rules"][string];
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
      kind: "aggregate";
      main: Catalog["aggregates"][string];
      branch: Catalog["aggregates"][string];
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
  const routineExpressionReplacementRoots = new Set<string>();
  for (const id of createdIds) {
    if (droppedIds.has(id)) {
      replaceRoots.add(id);
      if (isRoutineExpressionReplacementRoot(id)) {
        routineExpressionReplacementRoots.add(id);
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

  // Procedure and aggregate stableIds are signature-qualified, so a routine
  // whose parameter types change has different ids in `createdIds` and
  // `droppedIds` and would not appear in the intersection above. Treat any
  // dropped routine whose `(kind, schema, name)` matches a created routine as a
  // replace root so dependents referencing the old signature via pg_depend get
  // promoted or temporarily released.
  const createdRoutineNames = new Set<string>();
  for (const id of createdIds) {
    const key = parseRoutineSchemaName(id);
    if (key) createdRoutineNames.add(key);
  }
  for (const id of droppedIds) {
    const key = parseRoutineSchemaName(id);
    if (key && createdRoutineNames.has(key)) {
      replaceRoots.add(id);
      routineExpressionReplacementRoots.add(id);
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
  const generatedColumnsRecreatedByExpressionFallback =
    collectCoveredGeneratedColumnRecreations(changes);

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
        generatedColumnsRecreatedByExpressionFallback.has(refId) &&
        isOwnerTableDependentForColumn(refId, dependentRaw)
      ) {
        // A table has catalog bookkeeping dependencies on its own columns. The
        // generated-column fallback already drops and recreates the column, so
        // that internal table->column edge must not promote the whole table.
        continue;
      }
      if (
        generatedColumnsRecreatedByExpressionFallback.has(refId) &&
        isGeneratedColumnNotNullConstraintDependent({
          columnId: refId,
          dependentId: dependentRaw,
          mainCatalog,
          branchCatalog,
        })
      ) {
        // PostgreSQL 18 stores NOT NULL as a pg_constraint dependency, but
        // pg-delta models it on the column. Dropping/re-adding the generated
        // column already releases and restores this edge.
        continue;
      }

      if (
        shouldHandleRoutineExpressionDependent({
          refId,
          dependentRaw,
          routineExpressionReplacementRoots,
        })
      ) {
        const releaseCovered =
          expressionDependentCoverage.release.has(dependentRaw);
        const restoreCovered =
          expressionDependentCoverage.restore.has(dependentRaw);
        if (releaseCovered && restoreCovered) {
          if (generatedColumnsRecreatedByExpressionFallback.has(dependentRaw)) {
            queueRefForTraversal(dependentRaw, visitedRefs, queue);
          }
          continue;
        }

        const expressionReplacementChanges =
          buildExpressionDependentReplacementChanges({
            refId,
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
        maybeAddRoutineDependentPublicationReplacement({
          refId,
          dependentRaw,
          routineExpressionReplacementRoots,
          mainCatalog,
          branchCatalog,
          additions,
          existingChanges: [...changes, ...additions],
          visitedTargets,
        })
      ) {
        continue;
      }

      if (
        maybeAddColumnDependentPublicationReplacement({
          refId,
          dependentRaw,
          mainCatalog,
          branchCatalog,
          additions,
          existingChanges: [...changes, ...additions],
          visitedTargets,
        })
      ) {
        continue;
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
          routineExpressionReplacementRoots,
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

      const retainedIndexChanges =
        resolved.kind === "table" || resolved.kind === "materialized_view"
          ? buildRetainedIndexReplacementChanges({
              relationStableId: targetId,
              mainCatalog,
              branchCatalog,
              createdIds,
              droppedIds,
              visitedTargets,
              diffContext,
            })
          : [];

      additions.push(...replacementChanges, ...retainedIndexChanges);
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
      for (const change of [...replacementChanges, ...retainedIndexChanges]) {
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

function collectCoveredGeneratedColumnRecreations(
  changes: readonly Change[],
): Set<string> {
  const release = new Set<string>();
  const restore = new Set<string>();

  for (const change of changes) {
    if (change instanceof AlterTableDropColumn && change.column.is_generated) {
      release.add(
        stableId.column(
          change.table.schema,
          change.table.name,
          change.column.name,
        ),
      );
    }
    if (change instanceof AlterTableAddColumn && change.column.is_generated) {
      restore.add(
        stableId.column(
          change.table.schema,
          change.table.name,
          change.column.name,
        ),
      );
    }
  }

  return new Set([...release].filter((columnId) => restore.has(columnId)));
}

function shouldSuppressCoveredExpressionDependent({
  refId,
  dependentRaw,
  expressionDependentCoverage,
  routineExpressionReplacementRoots,
}: {
  refId: string;
  dependentRaw: string;
  expressionDependentCoverage: {
    release: ReadonlySet<string>;
    restore: ReadonlySet<string>;
  };
  routineExpressionReplacementRoots: ReadonlySet<string>;
}): boolean {
  // Routine replacement can require expression containers to release their
  // pg_depend edge before the old routine is dropped. When the original diff
  // already emitted that targeted expression change, promoting the normalized
  // table/domain owner to DROP+CREATE would be redundant and destructive.
  return (
    routineExpressionReplacementRoots.has(refId) &&
    isExpressionContainerStableId(dependentRaw) &&
    expressionDependentCoverage.release.has(dependentRaw) &&
    expressionDependentCoverage.restore.has(dependentRaw)
  );
}

function shouldHandleRoutineExpressionDependent({
  refId,
  dependentRaw,
  routineExpressionReplacementRoots,
}: {
  refId: string;
  dependentRaw: string;
  routineExpressionReplacementRoots: ReadonlySet<string>;
}): boolean {
  return (
    routineExpressionReplacementRoots.has(refId) &&
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

function isOwnerTableDependentForColumn(
  columnId: string,
  dependentId: string,
): boolean {
  const columnRef = parseColumnStableId(columnId);
  if (!columnRef) return false;

  return dependentId === stableId.table(columnRef.schema, columnRef.table);
}

function isGeneratedColumnNotNullConstraintDependent({
  columnId,
  dependentId,
  mainCatalog,
  branchCatalog,
}: {
  columnId: string;
  dependentId: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}): boolean {
  const columnRef = parseColumnStableId(columnId);
  const constraintRef = parseConstraintStableId(dependentId);
  if (
    !columnRef ||
    !constraintRef ||
    constraintRef.schema !== columnRef.schema ||
    constraintRef.owner !== columnRef.table
  ) {
    return false;
  }

  const tableId = stableId.table(columnRef.schema, columnRef.table);
  const mainTable = mainCatalog.tables[tableId];
  const branchTable = branchCatalog.tables[tableId];
  const mainColumn = mainTable?.columns.find(
    (column) => column.name === columnRef.column,
  );
  const branchColumn = branchTable?.columns.find(
    (column) => column.name === columnRef.column,
  );
  const modeledConstraint = Boolean(
    mainTable?.constraints.some(
      (constraint) => constraint.name === constraintRef.constraint,
    ) ||
    branchTable?.constraints.some(
      (constraint) => constraint.name === constraintRef.constraint,
    ),
  );
  const generatedColumnNotNull = Boolean(
    (mainColumn?.is_generated && mainColumn.not_null) ||
    (branchColumn?.is_generated && branchColumn.not_null),
  );

  return (
    !modeledConstraint &&
    constraintRef.constraint ===
      `${columnRef.table}_${columnRef.column}_not_null` &&
    generatedColumnNotNull
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
  refId,
  dependentRaw,
  mainCatalog,
  branchCatalog,
  diffContext,
  createdIds,
  existingChanges,
  addRelease,
  addRestore,
}: {
  refId: string;
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
      refId,
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

function maybeAddRoutineDependentPublicationReplacement({
  refId,
  dependentRaw,
  routineExpressionReplacementRoots,
  mainCatalog,
  branchCatalog,
  additions,
  existingChanges,
  visitedTargets,
}: {
  refId: string;
  dependentRaw: string;
  routineExpressionReplacementRoots: ReadonlySet<string>;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  additions: Change[];
  existingChanges: readonly Change[];
  visitedTargets: Set<string>;
}): boolean {
  if (
    !routineExpressionReplacementRoots.has(refId) ||
    !dependentRaw.startsWith("publication:")
  ) {
    return false;
  }
  const visitKey = publicationRowFilterReplacementVisitKey(dependentRaw);
  if (visitedTargets.has(visitKey)) return true;

  const replacementChanges = buildPublicationRowFilterReplacementChanges({
    publicationId: dependentRaw,
    mainCatalog,
    branchCatalog,
    existingChanges,
  });
  if (!replacementChanges) return false;

  additions.push(...replacementChanges);
  visitedTargets.add(visitKey);
  return true;
}

function maybeAddColumnDependentPublicationReplacement({
  refId,
  dependentRaw,
  mainCatalog,
  branchCatalog,
  additions,
  existingChanges,
  visitedTargets,
}: {
  refId: string;
  dependentRaw: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  additions: Change[];
  existingChanges: readonly Change[];
  visitedTargets: Set<string>;
}): boolean {
  if (
    !refId.startsWith("column:") ||
    !dependentRaw.startsWith("publication:")
  ) {
    return false;
  }

  const replacement = buildPublicationColumnListReplacement({
    columnId: refId,
    publicationId: dependentRaw,
    mainCatalog,
    branchCatalog,
  });
  if (!replacement) return false;

  if (visitedTargets.has(replacement.visitKey)) return true;

  const addRelease = !publicationTableChangeCovered({
    changes: existingChanges,
    publicationId: replacement.mainPublication.stableId,
    table: replacement.mainTable,
    changeType: "drop",
  });
  const addRestore = !publicationTableChangeCovered({
    changes: existingChanges,
    publicationId: replacement.branchPublication.stableId,
    table: replacement.branchTable,
    changeType: "add",
  });

  if (addRelease || addRestore) {
    appendPublicationColumnListReplacement(additions, replacement, {
      addRelease,
      addRestore,
    });
  }
  visitedTargets.add(replacement.visitKey);
  return true;
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
  refId,
  dependentRaw,
  mainCatalog,
  branchCatalog,
  diffContext,
  createdIds,
  existingChanges,
  addRelease,
  addRestore,
}: {
  refId: string;
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

  const mainColumn = mainTable.columns.find(
    (column) => column.name === columnRef.column,
  );
  if (!mainColumn || mainColumn.default === null) return null;

  const branchColumn = branchTable.columns.find(
    (column) => column.name === columnRef.column,
  );
  if (!branchColumn) {
    // Partition child column drops are propagated from the parent table.
    // Treating the child pg_depend row as covered avoids duplicate child DDL.
    if (mainTable.is_partition || branchTable.is_partition) {
      return [];
    }
    // The branch removed this column. When the original diff already drops it,
    // that drop releases the pg_depend edge and there is no expression to
    // restore, so this dependent is handled without owner table replacement.
    return addRelease
      ? [new AlterTableDropColumn({ table: mainTable, column: mainColumn })]
      : [];
  }

  const generatedColumnInvolved =
    mainColumn.is_generated || branchColumn.is_generated;
  // Generated partition child columns are parent-managed only when the parent
  // column is also being recreated and the child expression matches the parent.
  // Child-specific generation expressions need their own restore after the
  // parent recreation propagates the parent expression.
  if (
    (mainTable.is_partition || branchTable.is_partition) &&
    generatedColumnInvolved &&
    isPartitionGeneratedColumnInheritedFromParent({
      mainTable,
      branchTable,
      columnName: columnRef.column,
      refId,
      mainCatalog,
      branchCatalog,
      existingChanges,
    })
  ) {
    return [];
  }
  if (generatedColumnInvolved) {
    const parentRecreationCoverage =
      mainTable.is_partition || branchTable.is_partition
        ? getPartitionGeneratedColumnParentRecreationCoverage({
            mainTable,
            branchTable,
            columnName: columnRef.column,
            refId,
            mainCatalog,
            existingChanges,
          })
        : null;
    if (parentRecreationCoverage?.release && parentRecreationCoverage.restore) {
      if ((diffContext?.version ?? 0) >= 170000) {
        return addRestore
          ? [
              new AlterTableAlterColumnSetDefault({
                table: branchTable,
                column: branchColumn,
              }),
            ]
          : [];
      }

      return null;
    }

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

function buildPublicationColumnListReplacement({
  columnId,
  publicationId,
  mainCatalog,
  branchCatalog,
}: {
  columnId: string;
  publicationId: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}): PublicationColumnListReplacement | null {
  const columnRef = parseColumnStableId(columnId);
  if (!columnRef) return null;

  const mainPublication = mainCatalog.publications[publicationId];
  const branchPublication = branchCatalog.publications[publicationId];
  if (!mainPublication || !branchPublication) return null;

  const mainTable = findPublicationTableForColumn(
    mainPublication.tables,
    columnRef,
  );
  const branchTable = findPublicationTableForColumn(
    branchPublication.tables,
    columnRef,
  );
  if (!mainTable || !branchTable) return null;

  return {
    mainPublication,
    branchPublication,
    mainTable,
    branchTable,
    visitKey: publicationTableReplacementVisitKey(publicationId, mainTable),
  };
}

type PublicationColumnListReplacement = {
  mainPublication: Catalog["publications"][string];
  branchPublication: Catalog["publications"][string];
  mainTable: PublicationTableProps;
  branchTable: PublicationTableProps;
  visitKey: string;
};

function appendPublicationColumnListReplacement(
  additions: Change[],
  replacement: PublicationColumnListReplacement,
  options: { addRelease: boolean; addRestore: boolean },
): void {
  if (options.addRelease) {
    const existingDrop = additions.find(
      (change): change is AlterPublicationDropTables =>
        change instanceof AlterPublicationDropTables &&
        change.publication.stableId === replacement.mainPublication.stableId,
    );
    if (existingDrop) {
      if (
        !publicationTableChangeCovered({
          changes: [existingDrop],
          publicationId: replacement.mainPublication.stableId,
          table: replacement.mainTable,
          changeType: "drop",
        })
      ) {
        existingDrop.tables.push(replacement.mainTable);
      }
    } else {
      additions.push(
        new AlterPublicationDropTables({
          publication: replacement.mainPublication,
          tables: [replacement.mainTable],
        }),
      );
    }
  }

  if (options.addRestore) {
    const existingAdd = additions.find(
      (change): change is AlterPublicationAddTables =>
        change instanceof AlterPublicationAddTables &&
        change.publication.stableId === replacement.branchPublication.stableId,
    );
    if (existingAdd) {
      if (
        !publicationTableChangeCovered({
          changes: [existingAdd],
          publicationId: replacement.branchPublication.stableId,
          table: replacement.branchTable,
          changeType: "add",
        })
      ) {
        existingAdd.tables.push(replacement.branchTable);
      }
    } else {
      additions.push(
        new AlterPublicationAddTables({
          publication: replacement.branchPublication,
          tables: [replacement.branchTable],
        }),
      );
    }
  }
}

function buildPublicationRowFilterReplacementChanges({
  publicationId,
  mainCatalog,
  branchCatalog,
  existingChanges,
}: {
  publicationId: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  existingChanges: readonly Change[];
}): Change[] | null {
  const mainPublication = mainCatalog.publications[publicationId];
  const branchPublication = branchCatalog.publications[publicationId];
  if (!mainPublication || !branchPublication) return null;

  const mainTables = mainPublication.tables.filter(
    (table) => table.row_filter !== null,
  );
  if (mainTables.length === 0) return null;

  const mainTableKeys = new Set(
    mainTables.map((table) => publicationTableKey(table)),
  );
  const branchTables = branchPublication.tables.filter((table) =>
    mainTableKeys.has(publicationTableKey(table)),
  );
  const branchTablesByKey = new Map(
    branchTables.map((table) => [publicationTableKey(table), table]),
  );
  const releaseTables = mainTables.filter(
    (table) =>
      !publicationTableChangeCovered({
        changes: existingChanges,
        publicationId,
        table,
        changeType: "drop",
      }),
  );
  const restoreTables = mainTables.flatMap((table) => {
    const tableKey = publicationTableKey(table);
    const branchTable = branchTablesByKey.get(tableKey);
    if (!branchTable) return [];
    return publicationTableChangeCovered({
      changes: existingChanges,
      publicationId,
      table: branchTable,
      changeType: "add",
    })
      ? []
      : [branchTable];
  });

  if (releaseTables.length === 0 && restoreTables.length === 0) return [];

  return [
    ...(releaseTables.length > 0
      ? [
          new AlterPublicationDropTables({
            publication: mainPublication,
            tables: releaseTables,
          }),
        ]
      : []),
    ...(restoreTables.length > 0
      ? [
          new AlterPublicationAddTables({
            publication: branchPublication,
            tables: restoreTables,
          }),
        ]
      : []),
  ];
}

function publicationRowFilterReplacementVisitKey(
  publicationId: string,
): string {
  return `publicationRowFilters:${publicationId}`;
}

function publicationTableReplacementVisitKey(
  publicationId: string,
  table: PublicationTableProps,
): string {
  return `publicationTable:${publicationId}:${publicationTableKey(table)}`;
}

function publicationTableKey(table: PublicationTableProps): string {
  return `${table.schema}.${table.name}`;
}

function publicationTableChangeCovered({
  changes,
  publicationId,
  table,
  changeType,
}: {
  changes: readonly Change[];
  publicationId: string;
  table: PublicationTableProps;
  changeType: "add" | "drop";
}): boolean {
  const changeClass =
    changeType === "add"
      ? AlterPublicationAddTables
      : AlterPublicationDropTables;
  const tableStableId = stableId.table(table.schema, table.name);

  return changes.some((change) => {
    if (!(change instanceof changeClass)) return false;
    if (change.publication.stableId !== publicationId) return false;

    return changeType === "add"
      ? change.requires.includes(tableStableId)
      : change.drops.includes(tableStableId);
  });
}

function findPublicationTableForColumn(
  tables: readonly PublicationTableProps[],
  columnRef: ColumnStableIdParts,
): PublicationTableProps | null {
  return (
    tables.find(
      (table) =>
        table.schema === columnRef.schema &&
        table.name === columnRef.table &&
        (table.columns?.includes(columnRef.column) ||
          table.row_filter !== null),
    ) ?? null
  );
}

function isPartitionGeneratedColumnInheritedFromParent({
  mainTable,
  branchTable,
  columnName,
  refId,
  mainCatalog,
  branchCatalog,
  existingChanges,
}: {
  mainTable: Catalog["tables"][string];
  branchTable: Catalog["tables"][string];
  columnName: string;
  refId: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  existingChanges: readonly Change[];
}): boolean {
  if (
    !partitionGeneratedColumnExpressionsMatchParent({
      mainTable,
      branchTable,
      columnName,
      mainCatalog,
      branchCatalog,
    })
  ) {
    return false;
  }

  const coverage = getPartitionGeneratedColumnParentRecreationCoverage({
    mainTable,
    branchTable,
    columnName,
    refId,
    mainCatalog,
    existingChanges,
  });

  return Boolean(coverage?.release && coverage.restore);
}

function getPartitionGeneratedColumnParentRecreationCoverage({
  mainTable,
  branchTable,
  columnName,
  refId,
  mainCatalog,
  existingChanges,
}: {
  mainTable: Catalog["tables"][string];
  branchTable: Catalog["tables"][string];
  columnName: string;
  refId: string;
  mainCatalog: Catalog;
  existingChanges: readonly Change[];
}): { release: boolean; restore: boolean } | null {
  const mainParentColumnId =
    mainTable.parent_schema && mainTable.parent_name
      ? stableId.column(
          mainTable.parent_schema,
          mainTable.parent_name,
          columnName,
        )
      : null;
  const branchParentColumnId =
    branchTable.parent_schema && branchTable.parent_name
      ? stableId.column(
          branchTable.parent_schema,
          branchTable.parent_name,
          columnName,
        )
      : null;
  if (!mainParentColumnId || !branchParentColumnId) return null;

  const parentHasRoutineDependency = mainCatalog.depends.some(
    (dep) =>
      dep.dependent_stable_id === mainParentColumnId &&
      dep.referenced_stable_id === refId,
  );

  let releaseCovered = false;
  let restoreCovered = false;
  for (const change of existingChanges) {
    if (change instanceof AlterTableDropColumn) {
      releaseCovered ||=
        stableId.column(
          change.table.schema,
          change.table.name,
          change.column.name,
        ) === mainParentColumnId;
    }
    if (change instanceof AlterTableAddColumn) {
      restoreCovered ||=
        stableId.column(
          change.table.schema,
          change.table.name,
          change.column.name,
        ) === branchParentColumnId;
    }
  }

  return {
    release: parentHasRoutineDependency || releaseCovered,
    restore: parentHasRoutineDependency || restoreCovered,
  };
}

function partitionGeneratedColumnExpressionsMatchParent({
  mainTable,
  branchTable,
  columnName,
  mainCatalog,
  branchCatalog,
}: {
  mainTable: Catalog["tables"][string];
  branchTable: Catalog["tables"][string];
  columnName: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}): boolean {
  const mainColumn = findColumn(mainTable, columnName);
  const branchColumn = findColumn(branchTable, columnName);
  const mainParentColumn = findParentColumn(mainTable, columnName, mainCatalog);
  const branchParentColumn = findParentColumn(
    branchTable,
    columnName,
    branchCatalog,
  );

  return (
    Boolean(mainColumn?.is_generated) &&
    Boolean(branchColumn?.is_generated) &&
    Boolean(mainParentColumn?.is_generated) &&
    Boolean(branchParentColumn?.is_generated) &&
    mainColumn?.default === mainParentColumn?.default &&
    branchColumn?.default === branchParentColumn?.default
  );
}

function findParentColumn(
  table: Catalog["tables"][string],
  columnName: string,
  catalog: Catalog,
): TableProps["columns"][number] | undefined {
  if (!table.parent_schema || !table.parent_name) return undefined;
  const parentTable =
    catalog.tables[stableId.table(table.parent_schema, table.parent_name)];
  return parentTable ? findColumn(parentTable, columnName) : undefined;
}

function findColumn(
  table: Catalog["tables"][string],
  columnName: string,
): TableProps["columns"][number] | undefined {
  return table.columns.find((column) => column.name === columnName);
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

function isRoutineExpressionReplacementRoot(stableId: string): boolean {
  return stableId.startsWith("procedure:") || stableId.startsWith("aggregate:");
}

function parseRoutineSchemaName(stableId: string): string | null {
  const prefix = stableId.startsWith("procedure:")
    ? "procedure:"
    : stableId.startsWith("aggregate:")
      ? "aggregate:"
      : null;
  if (prefix === null) return null;
  const paren = stableId.indexOf("(");
  if (paren === -1) return null;
  return `${prefix}${stableId.slice(prefix.length, paren)}`;
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
          branchMaterializedView:
            branchCatalog.materializedViews[branch.tableStableId],
          branchTable: branchCatalog.tables[branch.tableStableId],
        }
      : null;
  }

  if (stableId.startsWith("trigger:")) {
    const main = mainCatalog.triggers[stableId];
    const branch = branchCatalog.triggers[stableId];
    if (main && branch) {
      const branchTableId = `table:${branch.schema}.${branch.table_name}`;
      return {
        kind: "trigger",
        main,
        branch,
        branchIndexableObject: branchCatalog.indexableObjects[branchTableId],
      };
    }
    return null;
  }

  if (stableId.startsWith("rule:")) {
    const main = mainCatalog.rules[stableId];
    const branch = branchCatalog.rules[stableId];
    return main && branch ? { kind: "rule", main, branch } : null;
  }

  if (stableId.startsWith("procedure:")) {
    const main = mainCatalog.procedures[stableId];
    const branch = branchCatalog.procedures[stableId];
    return main && branch ? { kind: "procedure", main, branch } : null;
  }

  if (stableId.startsWith("aggregate:")) {
    const main = mainCatalog.aggregates[stableId];
    const branch = branchCatalog.aggregates[stableId];
    return main && branch ? { kind: "aggregate", main, branch } : null;
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

function buildRetainedIndexReplacementChanges({
  relationStableId,
  mainCatalog,
  branchCatalog,
  createdIds,
  droppedIds,
  visitedTargets,
  diffContext,
}: {
  relationStableId: string;
  mainCatalog: Catalog;
  branchCatalog: Catalog;
  createdIds: ReadonlySet<string>;
  droppedIds: ReadonlySet<string>;
  visitedTargets: Set<string>;
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
}): Change[] {
  const changes: Change[] = [];
  // Dropping a table or materialized view also drops its indexes. A retained
  // relation replacement therefore has to recreate retained indexes from the
  // branch catalog, even when pg_depend does not expose a standalone
  // index -> relation edge for the graph walk.
  const branchIndexes = Object.values(branchCatalog.indexes)
    .filter((index) => index.tableStableId === relationStableId)
    .sort((a, b) => a.stableId.localeCompare(b.stableId));

  for (const branchIndex of branchIndexes) {
    const indexId = branchIndex.stableId;
    if (visitedTargets.has(indexId)) continue;
    if (!mainCatalog.indexes[indexId]) continue;
    if (createdIds.has(indexId) && droppedIds.has(indexId)) continue;

    const resolved = resolveObjectForStableId(
      indexId,
      mainCatalog,
      branchCatalog,
    );
    if (!resolved || resolved.kind !== "index") continue;

    const addDrop = !droppedIds.has(indexId);
    const addCreate = !createdIds.has(indexId);
    const replacementChanges = buildReplaceChanges(resolved, {
      addDrop,
      addCreate,
      diffContext,
    });
    if (!replacementChanges) continue;

    changes.push(...replacementChanges);
    visitedTargets.add(indexId);
  }

  return changes;
}

function buildRetainedClusterChange(
  resolved: Extract<ResolvedObject, { kind: "index" }>,
): Change[] {
  if (!resolved.branch.is_clustered) return [];
  if (resolved.branch.table_relkind === "m") {
    return resolved.branchMaterializedView
      ? [
          new AlterMaterializedViewClusterOn({
            materializedView: resolved.branchMaterializedView,
            indexName: resolved.branch.name,
          }),
        ]
      : [];
  }

  return resolved.branchTable
    ? [
        new AlterTableClusterOn({
          table: resolved.branchTable,
          indexName: resolved.branch.name,
        }),
      ]
    : [];
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
              ...buildRetainedClusterChange(resolved),
              ...(resolved.branch.is_replica_identity && resolved.branchTable
                ? [
                    new AlterTableSetReplicaIdentity({
                      table: resolved.branchTable,
                      mode: "i",
                      indexName: resolved.branch.name,
                    }),
                  ]
                : []),
            ]
          : []),
      ];
    case "trigger":
      if (
        resolved.main.is_partition_clone ||
        resolved.branch.is_partition_clone
      ) {
        return null;
      }
      return [
        ...(addDrop ? [new DropTrigger({ trigger: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateTrigger({
                trigger: resolved.branch,
                indexableObject: resolved.branchIndexableObject,
              }),
              ...(resolved.branch.comment !== null
                ? [new CreateCommentOnTrigger({ trigger: resolved.branch })]
                : []),
              ...(resolved.branch.enabled !== "O"
                ? [new SetTriggerEnabledState({ trigger: resolved.branch })]
                : []),
            ]
          : []),
      ];
    case "rule":
      return [
        ...(addDrop ? [new DropRule({ rule: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateRule({ rule: resolved.branch }),
              ...(resolved.branch.comment !== null
                ? [new CreateCommentOnRule({ rule: resolved.branch })]
                : []),
              ...(resolved.branch.enabled !== "O"
                ? [new SetRuleEnabledState({ rule: resolved.branch })]
                : []),
            ]
          : []),
      ];
    case "procedure":
      return [
        ...(addDrop ? [new DropProcedure({ procedure: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateProcedure({ procedure: resolved.branch }),
              ...buildRetainedProcedureMetadataChanges({
                procedure: resolved.branch,
                diffContext,
              }),
            ]
          : []),
      ];
    case "aggregate":
      return [
        ...(addDrop ? [new DropAggregate({ aggregate: resolved.main })] : []),
        ...(addCreate
          ? [
              new CreateAggregate({ aggregate: resolved.branch }),
              ...buildRetainedAggregateMetadataChanges({
                aggregate: resolved.branch,
                diffContext,
              }),
            ]
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

function buildRetainedProcedureMetadataChanges({
  procedure,
  diffContext,
}: {
  procedure: Catalog["procedures"][string];
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
}): Change[] {
  const changes: Change[] = [];

  if (diffContext && procedure.owner !== diffContext.currentUser) {
    changes.push(
      new AlterProcedureChangeOwner({
        procedure,
        owner: procedure.owner,
      }),
    );
  }

  if (procedure.comment !== null) {
    changes.push(new CreateCommentOnProcedure({ procedure }));
  }

  for (const securityLabel of procedure.security_labels) {
    changes.push(
      new CreateSecurityLabelOnProcedure({
        procedure,
        securityLabel,
      }),
    );
  }

  if (!diffContext) return changes;

  const effectiveDefaults =
    diffContext.defaultPrivilegeState.getEffectiveDefaults(
      diffContext.currentUser,
      "procedure",
      procedure.schema ?? "",
    );
  const creatorFilteredDefaults =
    procedure.owner !== diffContext.currentUser
      ? effectiveDefaults.filter((p) => p.grantee !== diffContext.currentUser)
      : effectiveDefaults;
  const desiredPrivileges = filterPublicBuiltInDefaults(
    "procedure",
    procedure.privileges,
  );
  const privilegeResults = diffPrivileges(
    filterPublicBuiltInDefaults("procedure", creatorFilteredDefaults),
    desiredPrivileges,
    procedure.owner,
  );

  changes.push(
    ...(emitObjectPrivilegeChanges(
      privilegeResults,
      procedure,
      procedure,
      "procedure",
      {
        Grant: GrantProcedurePrivileges,
        Revoke: RevokeProcedurePrivileges,
        RevokeGrantOption: RevokeGrantOptionProcedurePrivileges,
      },
      diffContext.version,
    ) as Change[]),
  );

  return changes;
}

function buildRetainedAggregateMetadataChanges({
  aggregate,
  diffContext,
}: {
  aggregate: Catalog["aggregates"][string];
  diffContext?: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >;
}): Change[] {
  const changes: Change[] = [];

  if (diffContext && aggregate.owner !== diffContext.currentUser) {
    changes.push(
      new AlterAggregateChangeOwner({
        aggregate,
        owner: aggregate.owner,
      }),
    );
  }

  if (aggregate.comment !== null) {
    changes.push(new CreateCommentOnAggregate({ aggregate }));
  }

  for (const securityLabel of aggregate.security_labels) {
    changes.push(
      new CreateSecurityLabelOnAggregate({
        aggregate,
        securityLabel,
      }),
    );
  }

  if (!diffContext) return changes;

  const effectiveDefaults =
    diffContext.defaultPrivilegeState.getEffectiveDefaults(
      diffContext.currentUser,
      "aggregate",
      aggregate.schema ?? "",
    );
  const creatorFilteredDefaults =
    aggregate.owner !== diffContext.currentUser
      ? effectiveDefaults.filter((p) => p.grantee !== diffContext.currentUser)
      : effectiveDefaults;
  const desiredPrivileges = filterPublicBuiltInDefaults(
    "aggregate",
    aggregate.privileges,
  );
  const privilegeResults = diffPrivileges(
    filterPublicBuiltInDefaults("aggregate", creatorFilteredDefaults),
    desiredPrivileges,
    aggregate.owner,
  );

  changes.push(
    ...(emitObjectPrivilegeChanges(
      privilegeResults,
      aggregate,
      aggregate,
      "aggregate",
      {
        Grant: GrantAggregatePrivileges,
        Revoke: RevokeAggregatePrivileges,
        RevokeGrantOption: RevokeGrantOptionAggregatePrivileges,
      },
      diffContext.version,
    ) as Change[]),
  );

  return changes;
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
