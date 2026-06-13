import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import type { ObjectDiffContext } from "./objects/diff-context.ts";
import { diffAggregates } from "./objects/aggregate/aggregate.diff.ts";
import { AlterAggregateChangeOwner } from "./objects/aggregate/changes/aggregate.alter.ts";
import { CreateAggregate } from "./objects/aggregate/changes/aggregate.create.ts";
import { DropAggregate } from "./objects/aggregate/changes/aggregate.drop.ts";
import { CreateDomain } from "./objects/domain/changes/domain.create.ts";
import { DropDomain } from "./objects/domain/changes/domain.drop.ts";
import { AlterIndexSetStatistics } from "./objects/index/changes/index.alter.ts";
import { CreateCommentOnIndex } from "./objects/index/changes/index.comment.ts";
import { CreateIndex } from "./objects/index/changes/index.create.ts";
import { DropIndex } from "./objects/index/changes/index.drop.ts";
import { CreateMaterializedView } from "./objects/materialized-view/changes/materialized-view.create.ts";
import { DropMaterializedView } from "./objects/materialized-view/changes/materialized-view.drop.ts";
import { buildCreateMaterializedViewChanges } from "./objects/materialized-view/materialized-view.diff.ts";
import { filterPublicBuiltInDefaults } from "./objects/base.privilege-diff.ts";
import { AlterProcedureChangeOwner } from "./objects/procedure/changes/procedure.alter.ts";
import { CreateCommentOnProcedure } from "./objects/procedure/changes/procedure.comment.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import { GrantProcedurePrivileges } from "./objects/procedure/changes/procedure.privilege.ts";
import { CreateSecurityLabelOnProcedure } from "./objects/procedure/changes/procedure.security-label.ts";
import { diffProcedures } from "./objects/procedure/procedure.diff.ts";
import {
  AlterPublicationAddTables,
  AlterPublicationDropTables,
} from "./objects/publication/changes/publication.alter.ts";
import {
  ReplaceRule,
  SetRuleEnabledState,
} from "./objects/rule/changes/rule.alter.ts";
import {
  CreateCommentOnRule,
  DropCommentOnRule,
} from "./objects/rule/changes/rule.comment.ts";
import { CreateRule } from "./objects/rule/changes/rule.create.ts";
import { DropRule } from "./objects/rule/changes/rule.drop.ts";
import { CreateCommentOnRlsPolicy } from "./objects/rls-policy/changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./objects/rls-policy/changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./objects/rls-policy/changes/rls-policy.drop.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnSetDefault,
  AlterTableDropConstraint,
  AlterTableDropColumn,
} from "./objects/table/changes/table.alter.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnConstraint,
} from "./objects/table/changes/table.comment.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { GrantTablePrivileges } from "./objects/table/changes/table.privilege.ts";
import { CreateSecurityLabelOnColumn } from "./objects/table/changes/table.security-label.ts";
import {
  ReplaceTrigger,
  SetTriggerEnabledState,
} from "./objects/trigger/changes/trigger.alter.ts";
import {
  CreateCommentOnTrigger,
  DropCommentOnTrigger,
} from "./objects/trigger/changes/trigger.comment.ts";
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
      kind: "rule";
      main: Catalog["rules"][string];
      branch: Catalog["rules"][string];
    }
  | {
      kind: "trigger";
      main: Catalog["triggers"][string];
      branch: Catalog["triggers"][string];
      branchIndexableObject: Catalog["indexableObjects"][string] | undefined;
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
  const invalidatedIds = new Set<string>();

  for (const change of changes) {
    for (const id of change.creates ?? []) createdIds.add(id);
    for (const id of change.drops ?? []) droppedIds.add(id);
    for (const id of change.invalidates ?? []) invalidatedIds.add(id);
  }

  const replaceRoots = new Set<string>();
  for (const id of createdIds) {
    if (droppedIds.has(id)) {
      replaceRoots.add(id);
    }
  }
  for (const id of invalidatedIds) {
    // In-place rewrites such as ALTER COLUMN TYPE do not drop/recreate the
    // referenced object, but PostgreSQL still requires dependent rewrite
    // objects (rules, trigger WHEN expressions, etc.) to be removed first.
    replaceRoots.add(id);
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

  const columnReplaceRoots = new Set(
    [...replaceRoots].filter(
      (id) =>
        id.startsWith("column:") && createdIds.has(id) && droppedIds.has(id),
    ),
  );

  const visitedTargets = new Set<string>();
  const visitedRefs = new Set<string>(replaceRoots);
  const refsReachedFromInvalidation = new Set([
    ...invalidatedIds,
    ...columnReplaceRoots,
  ]);
  const queue: string[] = [...replaceRoots];
  // Tables being replaced by an expansion-added DropTable+CreateTable pair.
  // Any pre-existing targeted AlterTable*(T) object-scope change is superseded
  // by the replacement and must be removed to avoid contradictions (e.g. an
  // AlterTableDropColumn on a table that is about to be dropped) and the
  // associated drop-phase cycle with the catalog constraint→column edge.
  const tablesReplacedByExpansion = new Set<string>();
  const rulesReplacedByExpansion = new Set<string>();
  const triggersReplacedByExpansion = new Set<string>();
  const generatedColumnsReplacedByExpansion = new Set<string>();
  const restoredGeneratedColumnDependents = new Set<string>();

  while (queue.length > 0) {
    const refId = queue.shift() as string;
    const reachedFromInvalidation = refsReachedFromInvalidation.has(refId);
    if (
      columnReplaceRoots.has(refId) &&
      !restoredGeneratedColumnDependents.has(refId) &&
      isGeneratedColumnReplacementTarget(refId, mainCatalog, branchCatalog)
    ) {
      const replacementChanges =
        buildGeneratedColumnDependentReplacementChanges(refId, branchCatalog, [
          ...changes,
          ...additions,
        ]);
      additions.push(...replacementChanges);
      trackChangeIds(replacementChanges, createdIds, droppedIds);
      restoredGeneratedColumnDependents.add(refId);
    }

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

      if (reachedFromInvalidation && dependentRaw.startsWith("column:")) {
        const replacementChanges = buildColumnDefaultReplacementChanges(
          dependentRaw,
          mainCatalog,
          branchCatalog,
          [...changes, ...additions],
        );
        additions.push(...replacementChanges);
        trackChangeIds(replacementChanges, createdIds, droppedIds);
        if (
          isGeneratedColumnReplacementTarget(
            dependentRaw,
            mainCatalog,
            branchCatalog,
          )
        ) {
          generatedColumnsReplacedByExpansion.add(dependentRaw);
          columnReplaceRoots.add(dependentRaw);
          refsReachedFromInvalidation.add(dependentRaw);
          if (!visitedRefs.has(dependentRaw)) {
            visitedRefs.add(dependentRaw);
            queue.push(dependentRaw);
          }
        }
      }
      if (reachedFromInvalidation && dependentRaw.startsWith("publication:")) {
        additions.push(
          ...buildPublicationTableReplacementChanges(
            refId,
            dependentRaw,
            mainCatalog,
            branchCatalog,
            [...changes, ...additions],
          ),
        );
      }
      const isColumnReplacementRoot =
        refId.startsWith("column:") &&
        createdIds.has(refId) &&
        droppedIds.has(refId);
      if (
        dependentRaw.startsWith("constraint:") &&
        (!reachedFromInvalidation ||
          isColumnReplacementRoot ||
          refId.startsWith("procedure:"))
      ) {
        const replacementChanges = buildConstraintReplacementChanges(
          dependentRaw,
          mainCatalog,
          branchCatalog,
          [...changes, ...additions],
        );
        additions.push(...replacementChanges);
        trackChangeIds(replacementChanges, createdIds, droppedIds);
        continue;
      }

      const targetId = normalizeDependentId(dependentRaw);
      if (!targetId) continue;
      if (
        reachedFromInvalidation &&
        !isRebuildableInvalidationDependent(targetId)
      ) {
        continue;
      }

      // Continue traversing the dependency graph from the raw dependent id.
      if (!visitedRefs.has(dependentRaw)) {
        visitedRefs.add(dependentRaw);
        if (reachedFromInvalidation) {
          refsReachedFromInvalidation.add(dependentRaw);
        }
        queue.push(dependentRaw);
      }

      // Also traverse using the normalized owning object id (e.g., table for a column).
      if (!visitedRefs.has(targetId)) {
        visitedRefs.add(targetId);
        if (reachedFromInvalidation) {
          refsReachedFromInvalidation.add(targetId);
        }
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
      const replaceRewriteObject =
        addDrop && (resolved.kind === "rule" || resolved.kind === "trigger");
      const effectiveAddCreate = addCreate || replaceRewriteObject;

      if (!addDrop && !effectiveAddCreate) continue;

      const replacementChanges = buildReplaceChanges(resolved, {
        addDrop,
        addCreate: effectiveAddCreate,
        branchCatalog,
        diffContext,
        existingChanges: [...changes, ...additions],
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
      if (resolved.kind === "rule" && addDrop && effectiveAddCreate) {
        rulesReplacedByExpansion.add(targetId);
      }
      if (resolved.kind === "trigger" && addDrop && effectiveAddCreate) {
        triggersReplacedByExpansion.add(targetId);
      }

      // Track new creates/drops so we don't duplicate work for downstream dependents.
      trackChangeIds(replacementChanges, createdIds, droppedIds);
    }
  }

  if (additions.length === 0) {
    return {
      changes,
      replacedTableIds: tablesReplacedByExpansion,
    };
  }

  const retainedChanges = removeSupersededRlsPolicyAlters(
    removeSupersededGeneratedColumnDefaultAlters(
      changes,
      generatedColumnsReplacedByExpansion,
    ),
    promotedRlsPolicyIds,
  ).filter(
    (change) =>
      !isSupersededReplaceChange(
        change,
        rulesReplacedByExpansion,
        triggersReplacedByExpansion,
      ),
  );

  return {
    changes: [...retainedChanges, ...additions],
    replacedTableIds: tablesReplacedByExpansion,
  };
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

    const targetId = normalizeDependentId(dep.dependent_stable_id);
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
      branchCatalog,
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

function trackChangeIds(
  changes: readonly Change[],
  createdIds: Set<string>,
  droppedIds: Set<string>,
): void {
  for (const change of changes) {
    for (const id of change.creates ?? []) createdIds.add(id);
    for (const id of change.drops ?? []) droppedIds.add(id);
  }
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

function buildColumnDefaultReplacementChanges(
  columnStableId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
  existingChanges: readonly Change[],
): Change[] {
  const parsed = parseColumnStableId(columnStableId);
  if (!parsed) return [];

  const tableStableId = stableId.table(parsed.schema, parsed.table);
  const mainTable = mainCatalog.tables[tableStableId];
  const branchTable = branchCatalog.tables[tableStableId];
  if (!mainTable || !branchTable) return [];

  const mainColumn = mainTable.columns.find(
    (column) => column.name === parsed.column,
  );
  const branchColumn = branchTable.columns.find(
    (column) => column.name === parsed.column,
  );
  if (!mainColumn || !branchColumn) return [];
  if (mainColumn.default === null) return [];

  if (mainColumn.is_generated || branchColumn.is_generated) {
    // Generated columns cannot be safely reset through SET EXPRESSION here:
    // older servers do not support that syntax, and constrained columns can
    // reject the temporary NULL expression. Rebuild the column instead.
    const replacementChanges: Change[] = [];
    if (!hasColumnDropChange(existingChanges, columnStableId)) {
      replacementChanges.push(
        new AlterTableDropColumn({
          table: mainTable,
          column: mainColumn,
        }),
      );
    }
    if (!hasColumnAddChange(existingChanges, columnStableId)) {
      replacementChanges.push(
        new AlterTableAddColumn({
          table: branchTable,
          column: branchColumn,
        }),
      );
    }
    replacementChanges.push(
      ...buildGeneratedColumnDependentReplacementChanges(
        columnStableId,
        branchCatalog,
        [...existingChanges, ...replacementChanges],
      ),
    );
    return replacementChanges;
  }

  const replacementChanges: Change[] = [];
  if (!hasColumnDefaultDropChange(existingChanges, columnStableId)) {
    replacementChanges.push(
      new AlterTableAlterColumnDropDefault({
        table: branchTable,
        column: branchColumn,
      }),
    );
  }
  if (
    branchColumn.default !== null &&
    !hasColumnDefaultSetChange(existingChanges, columnStableId)
  ) {
    replacementChanges.push(
      new AlterTableAlterColumnSetDefault({
        table: branchTable,
        column: branchColumn,
      }),
    );
  }

  return replacementChanges;
}

function isGeneratedColumnReplacementTarget(
  columnStableId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
): boolean {
  const parsed = parseColumnStableId(columnStableId);
  if (!parsed) return false;

  const tableStableId = stableId.table(parsed.schema, parsed.table);
  const mainTable = mainCatalog.tables[tableStableId];
  const branchTable = branchCatalog.tables[tableStableId];
  if (!mainTable || !branchTable) return false;

  const mainColumn = mainTable.columns.find(
    (column) => column.name === parsed.column,
  );
  const branchColumn = branchTable.columns.find(
    (column) => column.name === parsed.column,
  );
  if (!mainColumn || !branchColumn) return false;

  return Boolean(
    mainColumn.default !== null &&
    (mainColumn.is_generated || branchColumn.is_generated),
  );
}

function hasColumnDropChange(
  changes: readonly Change[],
  columnStableId: string,
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterTableDropColumn &&
      stableId.column(
        change.table.schema,
        change.table.name,
        change.column.name,
      ) === columnStableId,
  );
}

function hasColumnAddChange(
  changes: readonly Change[],
  columnStableId: string,
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterTableAddColumn &&
      stableId.column(
        change.table.schema,
        change.table.name,
        change.column.name,
      ) === columnStableId,
  );
}

function buildGeneratedColumnDependentReplacementChanges(
  columnStableId: string,
  branchCatalog: Catalog,
  existingChanges: readonly Change[],
): Change[] {
  const parsed = parseColumnStableId(columnStableId);
  if (!parsed) return [];

  const tableStableId = stableId.table(parsed.schema, parsed.table);
  const branchTable = branchCatalog.tables[tableStableId];
  if (!branchTable) return [];

  const branchColumn = branchTable.columns.find(
    (column) => column.name === parsed.column,
  );
  if (!branchColumn) return [];

  const replacementChanges: Change[] = [];

  if (
    branchColumn.comment !== null &&
    branchColumn.comment !== undefined &&
    !hasChangeCreating(
      [...existingChanges, ...replacementChanges],
      stableId.comment(columnStableId),
    )
  ) {
    replacementChanges.push(
      new CreateCommentOnColumn({
        table: branchTable,
        column: branchColumn,
      }),
    );
  }

  for (const securityLabel of branchColumn.security_labels ?? []) {
    const securityLabelStableId = stableId.securityLabel(
      columnStableId,
      securityLabel.provider,
    );
    if (
      hasChangeCreating(
        [...existingChanges, ...replacementChanges],
        securityLabelStableId,
      )
    ) {
      continue;
    }
    replacementChanges.push(
      new CreateSecurityLabelOnColumn({
        table: branchTable,
        column: branchColumn,
        securityLabel,
      }),
    );
  }

  const dependentConstraintIds = new Set(
    branchCatalog.depends
      .filter(
        (dep) =>
          dep.referenced_stable_id === columnStableId &&
          dep.dependent_stable_id.startsWith("constraint:"),
      )
      .map((dep) => dep.dependent_stable_id),
  );

  for (const constraint of branchTable.constraints ?? []) {
    if (constraint.is_partition_clone) continue;

    const constraintStableId = stableId.constraint(
      branchTable.schema,
      branchTable.name,
      constraint.name,
    );
    if (!dependentConstraintIds.has(constraintStableId)) continue;

    if (
      !hasChangeCreating(
        [...existingChanges, ...replacementChanges],
        constraintStableId,
      )
    ) {
      replacementChanges.push(
        new AlterTableAddConstraint({
          table: branchTable,
          constraint,
        }),
      );
    }

    const constraintCommentStableId = stableId.comment(constraintStableId);
    if (
      constraint.comment !== null &&
      constraint.comment !== undefined &&
      !hasChangeCreating(
        [...existingChanges, ...replacementChanges],
        constraintCommentStableId,
      )
    ) {
      replacementChanges.push(
        new CreateCommentOnConstraint({
          table: branchTable,
          constraint,
        }),
      );
    }
  }

  replacementChanges.push(
    ...buildGeneratedColumnPrivilegeReplacementChanges(
      branchTable,
      parsed.column,
      existingChanges,
      replacementChanges,
    ),
  );

  return replacementChanges;
}

function buildGeneratedColumnPrivilegeReplacementChanges(
  branchTable: Catalog["tables"][string],
  columnName: string,
  existingChanges: readonly Change[],
  replacementChanges: readonly Change[],
): Change[] {
  const changes: Change[] = [];
  const privilegesByKey = new Map<
    string,
    {
      grantee: string;
      grantable: boolean;
      columns: string[];
      privileges: Set<string>;
    }
  >();

  for (const privilege of branchTable.privileges) {
    if (privilege.grantee === branchTable.owner) continue;
    if (!privilege.columns?.includes(columnName)) continue;

    const columns = [...privilege.columns].sort();
    const key = JSON.stringify({
      grantee: privilege.grantee,
      grantable: privilege.grantable,
      columns,
    });
    let group = privilegesByKey.get(key);
    if (!group) {
      group = {
        grantee: privilege.grantee,
        grantable: privilege.grantable,
        columns,
        privileges: new Set<string>(),
      };
      privilegesByKey.set(key, group);
    }
    group.privileges.add(privilege.privilege);
  }

  for (const group of privilegesByKey.values()) {
    const candidate = new GrantTablePrivileges({
      table: branchTable,
      grantee: group.grantee,
      privileges: [...group.privileges].sort().map((privilege) => ({
        privilege,
        grantable: group.grantable,
      })),
      columns: group.columns,
    });

    if (
      hasEquivalentColumnGrant(candidate, [
        ...existingChanges,
        ...replacementChanges,
        ...changes,
      ])
    ) {
      continue;
    }
    changes.push(candidate);
  }

  return changes;
}

function hasChangeCreating(
  changes: readonly Change[],
  createdStableId: string,
): boolean {
  return changes.some((change) =>
    (change.creates as readonly string[]).includes(createdStableId),
  );
}

function hasEquivalentColumnGrant(
  candidate: GrantTablePrivileges,
  changes: readonly Change[],
): boolean {
  return changes.some((change) => {
    if (!(change instanceof GrantTablePrivileges)) return false;
    if (change.table.stableId !== candidate.table.stableId) return false;
    if (change.grantee !== candidate.grantee) return false;
    if (!sameStringSet(change.columns ?? [], candidate.columns ?? [])) {
      return false;
    }
    if (
      !sameStringSet(
        change.privileges.map((privilege) => privilege.privilege),
        candidate.privileges.map((privilege) => privilege.privilege),
      )
    ) {
      return false;
    }
    return change.privileges.every(
      (privilege) => privilege.grantable === candidate.privileges[0]?.grantable,
    );
  });
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function buildPublicationTableReplacementChanges(
  invalidatedStableId: string,
  publicationStableId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
  existingChanges: readonly Change[],
): Change[] {
  const parsed = parseColumnStableId(invalidatedStableId);
  if (!parsed) return [];

  const mainPublication = mainCatalog.publications[publicationStableId];
  const branchPublication = branchCatalog.publications[publicationStableId];
  if (!mainPublication || !branchPublication) return [];

  const matchesInvalidatedTable = (table: { schema: string; name: string }) =>
    table.schema === parsed.schema && table.name === parsed.table;

  const mainTables = mainPublication.tables.filter(matchesInvalidatedTable);
  const branchTables = branchPublication.tables.filter(matchesInvalidatedTable);
  if (mainTables.length === 0 && branchTables.length === 0) return [];

  const replacementChanges: Change[] = [];
  if (
    mainTables.length > 0 &&
    !hasPublicationDropTablesChange(
      existingChanges,
      publicationStableId,
      mainTables,
    )
  ) {
    replacementChanges.push(
      new AlterPublicationDropTables({
        publication: mainPublication,
        tables: mainTables,
      }),
    );
  }
  if (
    branchTables.length > 0 &&
    !hasPublicationAddTablesChange(
      existingChanges,
      publicationStableId,
      branchTables,
    )
  ) {
    replacementChanges.push(
      new AlterPublicationAddTables({
        publication: branchPublication,
        tables: branchTables,
      }),
    );
  }

  return replacementChanges;
}

function buildConstraintReplacementChanges(
  constraintStableId: string,
  mainCatalog: Catalog,
  branchCatalog: Catalog,
  existingChanges: readonly Change[],
): Change[] {
  const parsed = parseConstraintStableId(constraintStableId);
  if (!parsed) return [];

  const tableStableId = stableId.table(parsed.schema, parsed.table);
  const mainTable = mainCatalog.tables[tableStableId];
  const branchTable = branchCatalog.tables[tableStableId];
  if (!mainTable && !branchTable) return [];

  const mainConstraint = mainTable?.constraints.find(
    (constraint) => constraint.name === parsed.constraint,
  );
  const branchConstraint = branchTable?.constraints.find(
    (constraint) => constraint.name === parsed.constraint,
  );
  if (!mainConstraint && !branchConstraint) return [];

  const replacementChanges: Change[] = [];
  if (
    mainTable &&
    mainConstraint &&
    !hasConstraintDropChange(existingChanges, constraintStableId)
  ) {
    replacementChanges.push(
      new AlterTableDropConstraint({
        table: mainTable,
        constraint: mainConstraint,
      }),
    );
  }

  if (
    branchTable &&
    branchConstraint &&
    !hasConstraintAddChange(
      [...existingChanges, ...replacementChanges],
      constraintStableId,
    )
  ) {
    replacementChanges.push(
      new AlterTableAddConstraint({
        table: branchTable,
        constraint: branchConstraint,
      }),
    );
  }

  if (
    branchTable &&
    branchConstraint?.comment !== null &&
    branchConstraint?.comment !== undefined &&
    !hasChangeCreating(
      [...existingChanges, ...replacementChanges],
      stableId.comment(constraintStableId),
    )
  ) {
    replacementChanges.push(
      new CreateCommentOnConstraint({
        table: branchTable,
        constraint: branchConstraint,
      }),
    );
  }

  const backingIndex = Object.values(branchCatalog.indexes).find(
    (index) =>
      index.is_owned_by_constraint &&
      index.schema === parsed.schema &&
      index.table_name === parsed.table &&
      index.name === parsed.constraint,
  );
  if (
    backingIndex?.comment !== null &&
    backingIndex?.comment !== undefined &&
    !hasChangeCreating(
      [...existingChanges, ...replacementChanges],
      stableId.comment(backingIndex.stableId),
    )
  ) {
    replacementChanges.push(new CreateCommentOnIndex({ index: backingIndex }));
  }

  return replacementChanges;
}

function parseConstraintStableId(
  constraintStableId: string,
): { schema: string; table: string; constraint: string } | null {
  if (!constraintStableId.startsWith("constraint:")) return null;
  const parts = constraintStableId.slice("constraint:".length).split(".");
  if (parts.length < 3) return null;
  const [schema, table, ...constraintParts] = parts;
  return { schema, table, constraint: constraintParts.join(".") };
}

function hasConstraintDropChange(
  changes: readonly Change[],
  constraintStableId: string,
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterTableDropConstraint &&
      stableId.constraint(
        change.table.schema,
        change.table.name,
        change.constraint.name,
      ) === constraintStableId,
  );
}

function hasConstraintAddChange(
  changes: readonly Change[],
  constraintStableId: string,
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterTableAddConstraint &&
      stableId.constraint(
        change.table.schema,
        change.table.name,
        change.constraint.name,
      ) === constraintStableId,
  );
}

function parseColumnStableId(
  columnStableId: string,
): { schema: string; table: string; column: string } | null {
  if (!columnStableId.startsWith("column:")) return null;
  const parts = columnStableId.slice("column:".length).split(".");
  if (parts.length < 3) return null;
  const [schema, table, ...columnParts] = parts;
  return { schema, table, column: columnParts.join(".") };
}

function hasColumnDefaultDropChange(
  changes: readonly Change[],
  columnStableId: string,
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterTableAlterColumnDropDefault &&
      stableId.column(
        change.table.schema,
        change.table.name,
        change.column.name,
      ) === columnStableId,
  );
}

function hasColumnDefaultSetChange(
  changes: readonly Change[],
  columnStableId: string,
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterTableAlterColumnSetDefault &&
      stableId.column(
        change.table.schema,
        change.table.name,
        change.column.name,
      ) === columnStableId,
  );
}

function removeSupersededGeneratedColumnDefaultAlters(
  changes: readonly Change[],
  replacedGeneratedColumnIds: ReadonlySet<string>,
): Change[] {
  if (replacedGeneratedColumnIds.size === 0) return [...changes];

  return changes.filter((change) => {
    if (
      !(
        change instanceof AlterTableAlterColumnDropDefault ||
        change instanceof AlterTableAlterColumnSetDefault
      )
    ) {
      return true;
    }

    const columnStableId = stableId.column(
      change.table.schema,
      change.table.name,
      change.column.name,
    );
    return !replacedGeneratedColumnIds.has(columnStableId);
  });
}

function hasPublicationDropTablesChange(
  changes: readonly Change[],
  publicationStableId: string,
  tables: readonly { schema: string; name: string }[],
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterPublicationDropTables &&
      change.publication.stableId === publicationStableId &&
      includesAllPublicationTables(change.tables, tables),
  );
}

function hasPublicationAddTablesChange(
  changes: readonly Change[],
  publicationStableId: string,
  tables: readonly { schema: string; name: string }[],
): boolean {
  return changes.some(
    (change) =>
      change instanceof AlterPublicationAddTables &&
      change.publication.stableId === publicationStableId &&
      includesAllPublicationTables(change.tables, tables),
  );
}

function includesAllPublicationTables(
  actual: readonly { schema: string; name: string }[],
  expected: readonly { schema: string; name: string }[],
): boolean {
  return expected.every((expectedTable) =>
    actual.some(
      (actualTable) =>
        actualTable.schema === expectedTable.schema &&
        actualTable.name === expectedTable.name,
    ),
  );
}

function parseProcedureSchemaName(stableId: string): string | null {
  if (!stableId.startsWith("procedure:")) return null;
  const paren = stableId.indexOf("(");
  if (paren === -1) return null;
  return stableId.slice("procedure:".length, paren);
}

function isRebuildableInvalidationDependent(dependentId: string): boolean {
  let id = dependentId;

  while (id.startsWith("comment:")) {
    id = id.slice("comment:".length);
  }

  // In-place invalidations, such as ALTER COLUMN TYPE, only need to synthesize
  // replacements for catalog objects that are safe to drop and recreate around
  // the rewrite. Constraints and columns are owned by the table diff path; if
  // they were normalized to table:* here, the expander could emit destructive
  // DropTable/CreateTable DDL for a table that should only be altered.
  return (
    id.startsWith("view:") ||
    id.startsWith("materializedView:") ||
    id.startsWith("index:") ||
    id.startsWith("procedure:") ||
    id.startsWith("aggregate:") ||
    id.startsWith("rlsPolicy:") ||
    id.startsWith("rule:") ||
    id.startsWith("trigger:")
  );
}

function normalizeDependentId(dependentId: string): string | null {
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
    const parts = id.slice("constraint:".length).split(".");
    if (parts.length >= 2) {
      const [schema, table] = parts;
      return `table:${schema}.${table}`;
    }
    return null;
  }

  return id;
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

  if (stableId.startsWith("rule:")) {
    const main = mainCatalog.rules[stableId];
    const branch = branchCatalog.rules[stableId];
    return main && branch ? { kind: "rule", main, branch } : null;
  }

  if (stableId.startsWith("trigger:")) {
    const main = mainCatalog.triggers[stableId];
    const branch = branchCatalog.triggers[stableId];
    if (!main || !branch) return null;
    // PostgreSQL manages partition trigger clones from the parent trigger, so
    // dependency expansion must match diffTriggers and never emit explicit clone
    // drop/create DDL.
    if (main.is_partition_clone || branch.is_partition_clone) return null;

    const tableStableId = `table:${branch.schema}.${branch.table_name}`;
    return {
      kind: "trigger",
      main,
      branch,
      branchIndexableObject: branchCatalog.indexableObjects[tableStableId],
    };
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

function buildMaterializedViewIndexReplacementChanges(
  materializedViewStableId: string,
  branchCatalog: Catalog | undefined,
  existingChanges: readonly Change[],
): Change[] {
  if (!branchCatalog) return [];

  const changes: Change[] = [];
  for (const index of Object.values(branchCatalog.indexes)) {
    if (index.tableStableId !== materializedViewStableId) continue;
    if (!isStandaloneRecreatableIndex(index)) continue;
    if (hasChangeCreating([...existingChanges, ...changes], index.stableId)) {
      continue;
    }

    changes.push(
      new CreateIndex({
        index,
        indexableObject: branchCatalog.indexableObjects[index.tableStableId],
      }),
    );

    if (
      index.comment !== null &&
      !hasChangeCreating(
        [...existingChanges, ...changes],
        stableId.comment(index.stableId),
      )
    ) {
      changes.push(new CreateCommentOnIndex({ index }));
    }
  }

  return changes;
}

function isStandaloneRecreatableIndex(
  index: Catalog["indexes"][string],
): boolean {
  return (
    !index.is_owned_by_constraint &&
    !index.is_primary &&
    !index.is_index_partition
  );
}

function buildReplaceChanges(
  resolved: ResolvedObject,
  options: {
    addDrop: boolean;
    addCreate: boolean;
    branchCatalog?: Catalog;
    existingChanges?: readonly Change[];
    diffContext?: Pick<
      ObjectDiffContext,
      "version" | "currentUser" | "defaultPrivilegeState"
    >;
  },
): Change[] | null {
  const {
    addDrop,
    addCreate,
    branchCatalog,
    existingChanges = [],
    diffContext,
  } = options;

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
          : addDrop
            ? buildViewMetadataReplacementChanges(
                resolved.branch,
                diffContext,
                existingChanges,
              )
            : []),
      ];
    case "materialized_view":
      return [
        ...(addDrop
          ? [new DropMaterializedView({ materializedView: resolved.main })]
          : []),
        ...(addCreate
          ? [
              ...(diffContext
                ? buildCreateMaterializedViewChanges(
                    diffContext,
                    resolved.branch,
                  )
                : [
                    new CreateMaterializedView({
                      materializedView: resolved.branch,
                    }),
                  ]),
              ...buildMaterializedViewIndexReplacementChanges(
                resolved.branch.stableId,
                branchCatalog,
                existingChanges,
              ),
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
              ...buildIndexStatisticsReplacementChanges(
                resolved.branch,
                existingChanges,
              ),
            ]
          : []),
      ];
    case "procedure":
      return [
        ...(addDrop ? [new DropProcedure({ procedure: resolved.main })] : []),
        ...(addCreate
          ? buildCreateProcedureReplacementChanges(
              resolved.branch,
              diffContext,
              existingChanges,
            )
          : addDrop
            ? buildProcedureMetadataReplacementChanges(
                resolved.branch,
                diffContext,
                existingChanges,
              )
            : []),
      ];
    case "aggregate":
      return [
        ...(addDrop ? [new DropAggregate({ aggregate: resolved.main })] : []),
        ...(addCreate
          ? buildCreateAggregateReplacementChanges(resolved.branch, diffContext)
          : addDrop
            ? buildAggregateMetadataReplacementChanges(
                resolved.branch,
                diffContext,
                existingChanges,
              )
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
    case "trigger":
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

function isSupersededReplaceChange(
  change: Change,
  ruleIds: ReadonlySet<string>,
  triggerIds: ReadonlySet<string>,
): boolean {
  if (change instanceof ReplaceRule || change instanceof CreateRule) {
    return ruleIds.has(change.rule.stableId);
  }
  if (
    change instanceof CreateCommentOnRule ||
    change instanceof DropCommentOnRule ||
    change instanceof SetRuleEnabledState
  ) {
    return ruleIds.has(change.rule.stableId);
  }
  if (change instanceof ReplaceTrigger || change instanceof CreateTrigger) {
    return triggerIds.has(change.trigger.stableId);
  }
  if (
    change instanceof CreateCommentOnTrigger ||
    change instanceof DropCommentOnTrigger ||
    change instanceof SetTriggerEnabledState
  ) {
    return triggerIds.has(change.trigger.stableId);
  }
  return false;
}

function buildCreateAggregateReplacementChanges(
  aggregate: Catalog["aggregates"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
): Change[] {
  return diffContext
    ? diffAggregates(diffContext, {}, { [aggregate.stableId]: aggregate })
    : [new CreateAggregate({ aggregate })];
}

function buildAggregateMetadataReplacementChanges(
  aggregate: Catalog["aggregates"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
  existingChanges: readonly Change[],
): Change[] {
  const candidateChanges = diffContext
    ? diffAggregates(diffContext, {}, { [aggregate.stableId]: aggregate })
    : [];
  const changes: Change[] = [];

  for (const candidate of candidateChanges) {
    if (candidate instanceof CreateAggregate) continue;
    if (
      hasEquivalentAggregateMetadataChange(candidate, [
        ...existingChanges,
        ...changes,
      ])
    ) {
      continue;
    }
    changes.push(candidate);
  }

  return changes;
}

function hasEquivalentAggregateMetadataChange(
  candidate: Change,
  changes: readonly Change[],
): boolean {
  if (candidate instanceof AlterAggregateChangeOwner) {
    return changes.some(
      (change) =>
        change instanceof AlterAggregateChangeOwner &&
        change.aggregate.stableId === candidate.aggregate.stableId &&
        change.owner === candidate.owner,
    );
  }

  const createdIds = candidate.creates ?? [];
  if (createdIds.length > 0) {
    return createdIds.every((id) => hasChangeCreating(changes, id));
  }

  const serialized = candidate.serialize();
  return changes.some(
    (change) =>
      change.constructor === candidate.constructor &&
      change.serialize() === serialized,
  );
}

function buildCreateProcedureReplacementChanges(
  procedure: Catalog["procedures"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
  existingChanges: readonly Change[] = [],
): Change[] {
  const changes: Change[] = diffContext
    ? diffProcedures(diffContext, {}, { [procedure.stableId]: procedure })
    : [new CreateProcedure({ procedure })];

  appendMissingProcedureMetadataChanges(
    changes,
    procedure,
    diffContext,
    existingChanges,
  );

  return changes;
}

function buildProcedureMetadataReplacementChanges(
  procedure: Catalog["procedures"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
  existingChanges: readonly Change[],
): Change[] {
  const changes: Change[] = [];
  appendMissingProcedureMetadataChanges(
    changes,
    procedure,
    diffContext,
    existingChanges,
  );
  return changes;
}

function appendMissingProcedureMetadataChanges(
  changes: Change[],
  procedure: Catalog["procedures"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
  existingChanges: readonly Change[],
): void {
  const candidateChanges = buildProcedureMetadataCandidateChanges(
    procedure,
    diffContext,
  );

  for (const candidate of candidateChanges) {
    if (
      hasEquivalentProcedureChange(candidate, [...existingChanges, ...changes])
    ) {
      continue;
    }
    changes.push(candidate);
  }
}

function buildProcedureMetadataCandidateChanges(
  procedure: Catalog["procedures"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
): Change[] {
  if (diffContext) {
    return diffProcedures(
      diffContext,
      {},
      { [procedure.stableId]: procedure },
    ).filter((change) => !(change instanceof CreateProcedure));
  }

  const changes: Change[] = [
    new AlterProcedureChangeOwner({
      procedure,
      owner: procedure.owner,
    }),
  ];

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

  const grantedPrivileges = filterPublicBuiltInDefaults(
    "procedure",
    procedure.privileges,
  ).filter((privilege) => privilege.grantee !== procedure.owner);
  const grantsByGrantee = new Map<
    string,
    { privilege: string; grantable: boolean }[]
  >();
  for (const privilege of grantedPrivileges) {
    const key = `${privilege.grantee}\0${privilege.grantable ? "1" : "0"}`;
    const existing = grantsByGrantee.get(key);
    const target = existing ?? [];
    target.push({
      privilege: privilege.privilege,
      grantable: privilege.grantable,
    });
    if (!existing) grantsByGrantee.set(key, target);
  }

  for (const [key, privileges] of grantsByGrantee) {
    const [grantee] = key.split("\0");
    changes.push(
      new GrantProcedurePrivileges({
        procedure,
        grantee,
        privileges,
        version: undefined,
      }),
    );
  }

  return changes;
}

function hasEquivalentProcedureChange(
  candidate: Change,
  existingChanges: readonly Change[],
): boolean {
  return existingChanges.some(
    (change) =>
      change.constructor === candidate.constructor &&
      change.serialize() === candidate.serialize(),
  );
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

function buildViewMetadataReplacementChanges(
  view: Catalog["views"][string],
  diffContext:
    | Pick<
        ObjectDiffContext,
        "version" | "currentUser" | "defaultPrivilegeState"
      >
    | undefined,
  existingChanges: readonly Change[],
): Change[] {
  if (!diffContext) return [];

  const changes: Change[] = [];
  const candidateChanges = buildCreateViewChanges(diffContext, view).filter(
    (change) => !(change instanceof CreateView),
  );

  for (const candidate of candidateChanges) {
    if (
      hasEquivalentReplacementMetadataChange(candidate, [
        ...existingChanges,
        ...changes,
      ])
    ) {
      continue;
    }
    changes.push(candidate);
  }

  return changes;
}

function buildIndexStatisticsReplacementChanges(
  index: Catalog["indexes"][string],
  existingChanges: readonly Change[],
): Change[] {
  const columnTargets = index.statistics_target.flatMap(
    (statistics, columnIndex) =>
      statistics >= 0 ? [{ columnNumber: columnIndex + 1, statistics }] : [],
  );
  if (columnTargets.length === 0) return [];

  const change = new AlterIndexSetStatistics({ index, columnTargets });
  return hasEquivalentReplacementMetadataChange(change, existingChanges)
    ? []
    : [change];
}

function hasEquivalentReplacementMetadataChange(
  candidate: Change,
  existingChanges: readonly Change[],
): boolean {
  const createdIds = candidate.creates ?? [];
  if (createdIds.length > 0) {
    return createdIds.every((id) => hasChangeCreating(existingChanges, id));
  }

  return existingChanges.some(
    (change) =>
      change.constructor === candidate.constructor &&
      change.serialize() === candidate.serialize(),
  );
}
