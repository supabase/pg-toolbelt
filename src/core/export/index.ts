/**
 * Declarative schema export.
 */

import type { Change } from "../change.types.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import type { Integration } from "../integrations/integration.types.ts";
import type { createPlan } from "../plan/create.ts";
import { DEFAULT_OPTIONS } from "../plan/sql-format/constants.ts";
import { formatSqlScript } from "../plan/statements.ts";
import { getFilePath } from "./file-mapper.ts";
import { groupChangesByFile } from "./grouper.ts";
import { getSimpleFilePath } from "./simple-file-mapper.ts";
import type {
  DeclarativeSchemaOutput,
  ExportMode,
  FileEntry,
} from "./types.ts";

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
  /**
   * File organization mode:
   * - "detailed" (default): One file per object in nested directories
   * - "simple": One file per category, flat structure (e.g., tables.sql, views.sql)
   */
  mode?: ExportMode;
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
  const mode = options?.mode ?? "detailed";

  // Declarative export targets the final state; exclude drop operations.
  // Exception: default_privilege drops (REVOKEs) are kept because they define
  // the desired privilege state (e.g. revoking implicit PUBLIC EXECUTE on
  // functions).  Without them the applied schema would retain PostgreSQL's
  // implicit defaults, causing a diff on verification.
  // Note: filtering by integration and dependency cascading are done in createPlan,
  // so we only filter out drops here.
  const declarativeChanges = sortedChanges.filter(
    (change) =>
      change.operation !== "drop" || change.scope === "default_privilege",
  );

  const { hash: sourceFingerprint, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    declarativeChanges,
  );
  const targetFingerprint = hashStableIds(ctx.branchCatalog, stableIds);

  const mapper = mode === "simple" ? getSimpleFilePath : getFilePath;
  // Simple mode sorts files by category priority (natural dependency hierarchy).
  // Detailed mode sorts by topological position (fine-grained per-object ordering).
  const sortBy = mode === "simple" ? "category" : "topological";
  const groups = groupChangesByFile(declarativeChanges, mapper, { sortBy });
  const files = groups.map((group, index) => {
    const statements = group.changes.map((change) =>
      serializeChange(change, integration),
    );
    // Disable function body validation for files containing routines.
    // In simple mode, functions come before tables so table defaults can
    // reference them, but function bodies may reference not-yet-created tables.
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
    sql: formatSqlScript(statements, {
      ...DEFAULT_OPTIONS,
      keywordCase: "upper",
    }),
    metadata,
  };
}
