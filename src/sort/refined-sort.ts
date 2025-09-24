import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../objects/base.change.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableDropColumn,
} from "../objects/table/changes/table.alter.ts";
import {
  refineByTopologicalWindows,
  type TopoWindowSpec,
} from "./topo-refine.ts";

// 2) Build pairwise from depends (referenced -> dependent)
type PgDependRow = {
  dependent_stable_id: string;
  referenced_stable_id: string;
};
function makePairwiseFromDepends(
  depends: PgDependRow[],
  options: { invert?: boolean } = {},
) {
  const edgesByRef = new Map<string, Set<string>>();
  for (const row of depends) {
    const ref = row.referenced_stable_id;
    const dep = row.dependent_stable_id;
    if (!edgesByRef.has(ref)) edgesByRef.set(ref, new Set());
    edgesByRef.get(ref)?.add(dep);
  }
  const hasEdge = (refs: string[], deps: string[]) => {
    for (const r of refs) {
      const outs = edgesByRef.get(r);
      if (!outs) continue;
      for (const d of deps) if (outs.has(d)) return true;
    }
    return false;
  };

  return (a: Change, b: Change) => {
    const aIds = a.dependencies,
      bIds = b.dependencies;
    if (hasEdge(aIds, bIds))
      return options.invert ? "b_before_a" : "a_before_b";
    if (hasEdge(bIds, aIds))
      return options.invert ? "a_before_b" : "b_before_a";
    return undefined;
  };
}

export interface RefinementContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export function applyRefinements(
  ctx: RefinementContext,
  list: Change[],
): Change[] {
  const specs: TopoWindowSpec<Change>[] = [
    {
      // ALTER TABLE (single pass):
      // - per table: DROP COLUMN before ADD COLUMN
      // - per table: ADD COLUMN before ADD CONSTRAINT
      // - per table: ADD COLUMN producing generated/default expression after its input columns
      // - cross table: PK/UNIQUE before FK that references the key's table
      filter: { operation: "alter", objectType: "table" },
      pairwise: (a, b) => {
        // 1) Per-table: DROP COLUMN before ADD COLUMN
        if (
          a instanceof AlterTableDropColumn &&
          b instanceof AlterTableAddColumn &&
          a.table.stableId === b.table.stableId
        )
          return "a_before_b";

        // 2) Per-table: ADD COLUMN before ADD CONSTRAINT
        if (
          a instanceof AlterTableAddColumn &&
          b instanceof AlterTableAddConstraint &&
          a.table.stableId === b.table.stableId
        )
          return "a_before_b";

        // 3) Per-table: ADD COLUMN dependency between columns via default/generated expression
        if (
          a instanceof AlterTableAddColumn &&
          b instanceof AlterTableAddColumn &&
          a.table.stableId === b.table.stableId
        ) {
          const aName = a.column.name;
          const bExpr = b.column.default ?? "";
          // naive substring check is sufficient for common cases; we avoid heavy parsing
          // ensure whole-word-ish match (boundaries by non-word chars)
          const pattern = new RegExp(
            `(^|[^a-zA-Z0-9_])${aName}([^a-zA-Z0-9_]|$)`,
          );
          if (bExpr && pattern.test(bExpr)) {
            return "a_before_b"; // a provides input to b's expression
          }
        }

        // 4) Cross-table: key before FK
        if (
          a instanceof AlterTableAddConstraint &&
          b instanceof AlterTableAddConstraint
        ) {
          const aIsKey =
            a.constraint.constraint_type === "p" ||
            a.constraint.constraint_type === "u";
          const bIsFk = b.constraint.constraint_type === "f";
          const bRefs = b.foreignKeyTable?.stableId;
          if (aIsKey && bIsFk && bRefs === a.table.stableId)
            return "a_before_b";
        }

        return undefined;
      },
    },
    {
      // CREATE view/mview topo by depends (use branch)
      filter: (c) =>
        (c.operation === "create" || c.operation === "alter") &&
        (c.objectType === "view" || c.objectType === "materialized_view"),
      pairwise: makePairwiseFromDepends(ctx.branchCatalog.depends),
    },
    {
      // DROP view/mview topo by depends (use main)
      filter: (c) =>
        c.operation === "drop" &&
        (c.objectType === "view" || c.objectType === "materialized_view"),
      pairwise: makePairwiseFromDepends(ctx.mainCatalog.depends, {
        invert: true,
      }),
    },
  ];

  return specs.reduce(
    (acc, spec) => refineByTopologicalWindows(acc, spec),
    list,
  );
}
