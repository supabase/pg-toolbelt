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
   * Prefix filenames with order numbers for alphabetical sorting.
   * When true, paths like "schemas/public/tables/users.sql" become
   * "schemas/public/tables/000001_users.sql" to ensure correct application order.
   * Only the filename is prefixed; directory components remain unchanged.
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
      ? prefixFilename(group.path, index + 1)
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

/**
 * Prefix only the filename portion of a path with a zero-padded order number.
 * Directory components are left unchanged so that folder structure is preserved.
 *
 * Example: prefixFilename("schemas/public/tables/users.sql", 1)
 *       → "schemas/public/tables/000001_users.sql"
 */
function prefixFilename(filePath: string, order: number): string {
  const prefix = String(order).padStart(6, "0");
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return `${prefix}_${filePath}`;
  }
  const dir = filePath.slice(0, lastSlash + 1);
  const file = filePath.slice(lastSlash + 1);
  return `${dir}${prefix}_${file}`;
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
