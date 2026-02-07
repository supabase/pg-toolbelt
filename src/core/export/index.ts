/**
 * Declarative schema export.
 */

import type { Change } from "../change.types.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { evaluatePattern } from "../integrations/filter/dsl.ts";
import type { Integration } from "../integrations/integration.types.ts";
import type { createPlan } from "../plan/create.ts";
import { formatSqlScript } from "../plan/statements.ts";
import { groupChangesByFile } from "./grouper.ts";
import type { DeclarativeSchemaOutput, FileEntry } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * The result of createPlan, containing the plan, sorted changes, and context.
 * Use this type when you have already confirmed createPlan returned non-null.
 */
export type PlanResult = NonNullable<Awaited<ReturnType<typeof createPlan>>>;

// ============================================================================
// Public API
// ============================================================================

export interface ExportOptions {
  /** Integration for custom serialization */
  integration?: Integration;
  /**
   * Prefix file paths with order numbers for alphabetical sorting.
   * When true, paths like "schemas/public/tables/users.sql" become
   * "000001_schemas/public/tables/users.sql" to ensure correct application order.
   */
  orderPrefix?: boolean;
}

/**
 * Export a declarative schema from a plan result.
 *
 * Takes the output of `createPlan()` and generates a declarative schema output
 * with files grouped by object type. Drop operations are excluded since
 * declarative mode targets the final desired state.
 *
 * Dependency-based filtering (cascading exclusions) is handled by `createPlan`,
 * so this function only needs to filter out drop operations.
 *
 * @param planResult - The result from createPlan() containing plan, sortedChanges, and ctx
 * @param options - Optional integration for custom serialization
 * @returns Declarative schema output with grouped files
 */
export function exportDeclarativeSchema(
  planResult: PlanResult,
  options?: ExportOptions,
): DeclarativeSchemaOutput {
  const { ctx, sortedChanges } = planResult;
  const integration = options?.integration;
  const orderPrefix = options?.orderPrefix ?? false;

  // Declarative export targets the final state; exclude drop operations.
  // Note: filtering by integration and dependency cascading are done in createPlan,
  // so we only filter out drops here.
  const excludeDrops = { not: { operation: "drop" as const } };
  const declarativeChanges = sortedChanges.filter((change) =>
    evaluatePattern(excludeDrops, change),
  );

  const { hash: sourceFingerprint, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    declarativeChanges,
  );
  const targetFingerprint = hashStableIds(ctx.branchCatalog, stableIds);

  const groups = groupChangesByFile(declarativeChanges);
  const files = groups.map((group, index) => {
    const statements = group.changes.map((change) =>
      serializeChange(change, integration),
    );
    const hasRoutines = group.changes.some(
      (c) => c.objectType === "procedure" || c.objectType === "aggregate",
    );
    if (hasRoutines) {
      statements.unshift("SET check_function_bodies = false");
    }
    const path = orderPrefix
      ? `${String(index + 1).padStart(6, "0")}_${group.path}`
      : group.path;
    return buildFileEntry(path, group.metadata, statements, index);
  });

  return {
    version: 1,
    mode: "declarative",
    generatedAt: new Date().toISOString(),
    source: { fingerprint: sourceFingerprint },
    target: { fingerprint: targetFingerprint },
    files,
  };
}

function serializeChange(change: Change, integration?: Integration): string {
  return integration?.serialize?.(change) ?? change.serialize();
}

function buildFileEntry(
  path: string,
  metadata: FileEntry["metadata"],
  statements: string[],
  order: number,
): FileEntry {
  return {
    path,
    order,
    statements: statements.length,
    sql: formatSqlScript(statements),
    metadata,
  };
}
