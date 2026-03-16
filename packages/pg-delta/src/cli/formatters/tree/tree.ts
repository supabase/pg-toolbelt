/**
 * Tree formatter for displaying plans hierarchically (compact mode).
 */

import type { HierarchicalPlan } from "../../../core/plan/index.ts";
import { createAnsiPalette } from "../../ansi.ts";
import { buildPlanTree } from "./tree-builder.ts";
import { renderTree } from "./tree-renderer.ts";

/**
 * Format a plan as a tree structure (compact mode).
 */
export function formatTree(
  plan: HierarchicalPlan,
  options: { useColors?: boolean } = {},
): string {
  const palette = createAnsiPalette(options.useColors !== false);
  const lines: string[] = [];

  const total = countTotalChanges(plan);
  lines.push(
    palette.bold(`📋 Migration Plan: ${total} change${total !== 1 ? "s" : ""}`),
  );
  const summary = buildPlanSummaryTable(plan, palette);
  if (summary) {
    lines.push("");
    lines.push(summary);
  }
  lines.push("");

  const tree = buildPlanTree(plan);
  lines.push(renderTree(tree, options.useColors !== false));

  lines.push("");
  lines.push(
    `${palette.green("+")} create   ${palette.yellow("~")} alter   ${palette.red("-")} drop`,
  );

  return lines.join("\n");
}

function countTotalChanges(plan: HierarchicalPlan): number {
  const byType: Record<
    string,
    { create: number; alter: number; drop: number }
  > = {};
  countFromHierarchy(plan, byType);
  let total = 0;
  for (const counts of Object.values(byType)) {
    total += counts.create + counts.alter + counts.drop;
  }
  return total;
}

/**
 * Build summary as a table showing counts by entity type and operation.
 * Exported for use by declarative-export to show the same summary style.
 */
function buildPlanSummaryTable(
  plan: HierarchicalPlan,
  palette: ReturnType<typeof createAnsiPalette>,
): string {
  const byType: Record<
    string,
    { create: number; alter: number; drop: number }
  > = {};
  countFromHierarchy(plan, byType);

  // Filter to only types with changes
  const entries = Object.entries(byType).filter(
    ([, counts]) => counts.create + counts.alter + counts.drop > 0,
  );

  if (entries.length === 0) {
    return "";
  }

  // Calculate column widths
  let maxNameWidth = 0;
  let maxCreateWidth = 0;
  let maxAlterWidth = 0;
  let maxDropWidth = 0;

  for (const [type, counts] of entries) {
    const typeStr = type.replace(/_/g, "-");
    maxNameWidth = Math.max(maxNameWidth, typeStr.length);
    // For width calculation, use "1" instead of "0" since we'll show "-" for zeros
    maxCreateWidth = Math.max(
      maxCreateWidth,
      counts.create > 0 ? counts.create.toString().length : 1,
    );
    maxAlterWidth = Math.max(
      maxAlterWidth,
      counts.alter > 0 ? counts.alter.toString().length : 1,
    );
    maxDropWidth = Math.max(
      maxDropWidth,
      counts.drop > 0 ? counts.drop.toString().length : 1,
    );
  }

  // Ensure minimum widths for headers
  maxNameWidth = Math.max(maxNameWidth, "Entity".length);
  maxCreateWidth = Math.max(maxCreateWidth, "Create".length);
  maxAlterWidth = Math.max(maxAlterWidth, "Alter".length);
  maxDropWidth = Math.max(maxDropWidth, "Drop".length);

  const lines: string[] = [];

  // Header
  lines.push(
    `${palette.bold("Entity".padEnd(maxNameWidth))}  ${palette.bold("Create".padStart(maxCreateWidth))}  ${palette.bold("Alter".padStart(maxAlterWidth))}  ${palette.bold("Drop".padStart(maxDropWidth))}`,
  );
  lines.push(
    `${palette.dim("-".repeat(maxNameWidth))}  ${palette.dim("-".repeat(maxCreateWidth))}  ${palette.dim("-".repeat(maxAlterWidth))}  ${palette.dim("-".repeat(maxDropWidth))}`,
  );

  // Rows
  for (const [type, counts] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const typeStr = type.replace(/_/g, "-");
    // Format numbers: show "-" for 0, pad and colorize
    const createDisplay = counts.create > 0 ? counts.create.toString() : "-";
    const alterDisplay = counts.alter > 0 ? counts.alter.toString() : "-";
    const dropDisplay = counts.drop > 0 ? counts.drop.toString() : "-";

    const createStr =
      counts.create > 0
        ? palette.green(createDisplay.padStart(maxCreateWidth))
        : palette.dim(createDisplay.padStart(maxCreateWidth));
    const alterStr =
      counts.alter > 0
        ? palette.yellow(alterDisplay.padStart(maxAlterWidth))
        : palette.dim(alterDisplay.padStart(maxAlterWidth));
    const dropStr =
      counts.drop > 0
        ? palette.red(dropDisplay.padStart(maxDropWidth))
        : palette.dim(dropDisplay.padStart(maxDropWidth));

    lines.push(
      `${typeStr.padEnd(maxNameWidth)}  ${createStr}  ${alterStr}  ${dropStr}`,
    );
  }

  return lines.join("\n");
}

/**
 * Count changes by type from hierarchy.
 */
function countFromHierarchy(
  plan: HierarchicalPlan,
  byType: Record<string, { create: number; alter: number; drop: number }>,
): void {
  const addCounts = (
    target: { create: number; alter: number; drop: number },
    source: { create: number; alter: number; drop: number },
  ) => {
    target.create += source.create;
    target.alter += source.alter;
    target.drop += source.drop;
  };

  function countGroup(
    group: {
      create: ChangeEntry[];
      alter: ChangeEntry[];
      drop: ChangeEntry[];
    },
    type: string,
  ) {
    if (!byType[type]) {
      byType[type] = { create: 0, alter: 0, drop: 0 };
    }
    byType[type].create += group.create.length;
    byType[type].alter += group.alter.length;
    byType[type].drop += group.drop.length;
  }

  // Cluster
  countGroup(plan.cluster.roles, "role");
  countGroup(plan.cluster.extensions, "extension");
  countGroup(plan.cluster.eventTriggers, "event-trigger");
  countGroup(plan.cluster.publications, "publication");
  countGroup(plan.cluster.subscriptions, "subscription");

  for (const schema of Object.values(plan.schemas)) {
    countGroup(schema.changes, "schema");
    countGroup(schema.functions, "function");
    countGroup(schema.procedures, "procedure");
    countGroup(schema.aggregates, "aggregate");
    countGroup(schema.sequences, "sequence");
    countGroup(schema.collations, "collation");

    for (const table of Object.values(schema.tables)) {
      const tableCounts = {
        create: table.changes.create.length,
        alter: table.changes.alter.length,
        drop: table.changes.drop.length,
      };

      // Roll column counts into table totals (no separate column row)
      addCounts(tableCounts, {
        create: table.columns.create.length,
        alter: table.columns.alter.length,
        drop: table.columns.drop.length,
      });

      // Apply rolled-up counts to table totals
      if (!byType.table) {
        byType.table = { create: 0, alter: 0, drop: 0 };
      }
      addCounts(byType.table, tableCounts);

      countGroup(table.indexes, "index");
      countGroup(table.triggers, "trigger");
      countGroup(table.rules, "rule");
      countGroup(table.policies, "policy");
    }

    for (const view of Object.values(schema.views)) {
      countGroup(view.changes, "view");
    }

    for (const matview of Object.values(schema.materializedViews)) {
      countGroup(matview.changes, "materialized-view");
    }

    countGroup(schema.types.enums, "enum");
    countGroup(schema.types.composites, "composite-type");
    countGroup(schema.types.ranges, "range");
    countGroup(schema.types.domains, "domain");
  }
}

import type { ChangeEntry } from "../../../core/plan/index.ts";
