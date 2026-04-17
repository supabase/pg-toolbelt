import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { CreateDomain } from "./objects/domain/changes/domain.create.ts";
import { DropDomain } from "./objects/domain/changes/domain.drop.ts";
import { CreateMaterializedView } from "./objects/materialized-view/changes/materialized-view.create.ts";
import { DropMaterializedView } from "./objects/materialized-view/changes/materialized-view.drop.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import {
  AlterTableAddConstraint,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableValidateConstraint,
} from "./objects/table/changes/table.alter.ts";
import { CreateCommentOnConstraint } from "./objects/table/changes/table.comment.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { CreateCompositeType } from "./objects/type/composite-type/changes/composite-type.create.ts";
import { DropCompositeType } from "./objects/type/composite-type/changes/composite-type.drop.ts";
import { CreateEnum } from "./objects/type/enum/changes/enum.create.ts";
import { DropEnum } from "./objects/type/enum/changes/enum.drop.ts";
import { CreateRange } from "./objects/type/range/changes/range.create.ts";
import { DropRange } from "./objects/type/range/changes/range.drop.ts";
import { stableId } from "./objects/utils.ts";
import { CreateView } from "./objects/view/changes/view.create.ts";
import { DropView } from "./objects/view/changes/view.drop.ts";

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
 * New changes are appended; ordering is handled later by the sorter.
 */
export function expandReplaceDependencies({
  changes,
  mainCatalog,
  branchCatalog,
}: {
  changes: Change[];
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}): Change[] {
  const createdIds = new Set<string>();
  const droppedIds = new Set<string>();

  for (const change of changes) {
    for (const id of change.creates ?? []) createdIds.add(id);
    for (const id of change.drops ?? []) droppedIds.add(id);
  }

  const replaceRoots = new Set<string>();
  for (const id of createdIds) {
    if (droppedIds.has(id)) {
      replaceRoots.add(id);
    }
  }

  if (replaceRoots.size === 0) {
    return changes;
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

  const additions: Change[] = [];
  const visitedTargets = new Set<string>();
  const visitedRefs = new Set<string>(replaceRoots);
  const queue: string[] = [...replaceRoots];
  // Tables being replaced by an expansion-added DropTable+CreateTable pair.
  // Any pre-existing targeted AlterTable*(T) object-scope change is superseded
  // by the replacement and must be removed to avoid contradictions (e.g. an
  // AlterTableDropColumn on a table that is about to be dropped) and the
  // associated drop-phase cycle with the catalog constraint→column edge.
  const tablesReplacedByExpansion = new Set<string>();

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

      // Continue traversing the dependency graph from the raw dependent id.
      if (!visitedRefs.has(dependentRaw)) {
        visitedRefs.add(dependentRaw);
        queue.push(dependentRaw);
      }

      const targetId = normalizeDependentId(dependentRaw);
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
      });
      if (!replacementChanges) continue;

      additions.push(...replacementChanges);

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

  if (additions.length === 0 && tablesReplacedByExpansion.size === 0) {
    return changes;
  }

  const carriedChanges =
    tablesReplacedByExpansion.size === 0
      ? changes
      : changes.filter(
          (change) =>
            !isSupersededByTableReplacement(change, tablesReplacedByExpansion),
        );

  return [...carriedChanges, ...additions];
}

/**
 * Identify pre-existing changes that are made redundant by — AND that would
 * form an unbreakable drop-phase cycle against — an expansion-added
 * DropTable+CreateTable replacement pair on the same table.
 *
 * Only `AlterTableDropColumn` and `AlterTableDropConstraint` qualify: both
 * expose `requires = [table.stableId, column-or-constraint.stableId]`, and it
 * is that `table.stableId` entry that produces the explicit
 * `column:T.col → table:T` (or `constraint:T.c → table:T`) drop-phase edge
 * which closes a cycle against the catalog `constraint → column → table`
 * edges.
 *
 * Other object-scope `AlterTable*(T)` changes — owner, RLS toggles, replica
 * identity, storage parameters, SET LOGGED/UNLOGGED — do NOT participate in
 * this cycle and MUST be preserved: `CreateTable.serialize()` does not emit
 * those inline, so removing them would silently regress the recreated
 * table's state. The sort phase correctly orders them after `CreateTable(T)`
 * via their `table.stableId` requirement.
 */
function isSupersededByTableReplacement(
  change: Change,
  replacedTableIds: Set<string>,
): boolean {
  if (
    !(change instanceof AlterTableDropColumn) &&
    !(change instanceof AlterTableDropConstraint)
  ) {
    return false;
  }
  return replacedTableIds.has(change.table.stableId);
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

  if (stableId.startsWith("procedure:")) {
    const main = mainCatalog.procedures[stableId];
    const branch = branchCatalog.procedures[stableId];
    return main && branch ? { kind: "procedure", main, branch } : null;
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
  options: { addDrop: boolean; addCreate: boolean },
): Change[] | null {
  const { addDrop, addCreate } = options;

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
                  if (!constraint.validated) {
                    items.push(
                      new AlterTableValidateConstraint({
                        table: resolved.branch,
                        constraint,
                      }),
                    );
                  }
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
        ...(addCreate ? [new CreateView({ view: resolved.branch })] : []),
      ];
    case "materialized_view":
      return [
        ...(addDrop
          ? [new DropMaterializedView({ materializedView: resolved.main })]
          : []),
        ...(addCreate
          ? [new CreateMaterializedView({ materializedView: resolved.branch })]
          : []),
      ];
    case "procedure":
      return [
        ...(addDrop ? [new DropProcedure({ procedure: resolved.main })] : []),
        ...(addCreate
          ? [new CreateProcedure({ procedure: resolved.branch })]
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
