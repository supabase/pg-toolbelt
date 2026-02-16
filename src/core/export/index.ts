/**
 * Declarative schema export.
 */

import type { Change } from "../change.types.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import type { Integration } from "../integrations/integration.types.ts";
import type { createPlan } from "../plan/create.ts";
import { DEFAULT_OPTIONS } from "../plan/sql-format/constants.ts";
import type { SqlFormatOptions } from "../plan/sql-format/types.ts";
import { formatSqlScript } from "../plan/statements.ts";
import { createFileMapper } from "./file-mapper.ts";
import { groupChangesByFile } from "./grouper.ts";
import type {
  DeclarativeSchemaOutput,
  FileEntry,
  Grouping,
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
   * SQL formatter options to control the output style.
   * Merged on top of the default export options (maxWidth: 180, keywordCase: "upper").
   * See `SqlFormatOptions` for available keys.
   */
  formatOptions?: SqlFormatOptions | null;
  /**
   * Group entities by name prefix into consolidated files or subdirectories.
   * Supports automatic partition detection and/or explicit prefix lists.
   */
  grouping?: Grouping;
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
  const formatOptions: SqlFormatOptions | undefined =
    options?.formatOptions === null
      ? undefined
      : {
          ...DEFAULT_OPTIONS,
          maxWidth: 180,
          keywordCase: "upper",
          ...options?.formatOptions,
        };

  // // Declarative export targets the final state; exclude drop operations.
  // // Exception: default_privilege drops (REVOKEs) are kept because they define
  // // the desired privilege state (e.g. revoking implicit PUBLIC EXECUTE on
  // // functions).  Without them the applied schema would retain PostgreSQL's
  // // implicit defaults, causing a diff on verification.
  // // Note: filtering by integration and dependency cascading are done in createPlan,
  // // so we only filter out drops here.
  const declarativeChanges = sortedChanges;
  // .filter(
  //   (change) =>
  //     change.operation !== "drop" || change.scope === "default_privilege",
  // );

  const { hash: sourceFingerprint, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    declarativeChanges,
  );
  const targetFingerprint = hashStableIds(ctx.branchCatalog, stableIds);

  const mapper = createFileMapper(options?.grouping);
  const groups = groupChangesByFile(declarativeChanges, mapper);
  const files = groups.map((group, index) => {
    const statements = group.changes.map((change) =>
      serializeChange(change, integration),
    );
    return buildFileEntry(
      group.path,
      group.metadata,
      statements,
      index,
      formatOptions,
    );
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
  formatOptions?: SqlFormatOptions,
): FileEntry {
  return {
    path,
    order,
    statements: statements.length,
    sql: formatSqlScript(statements, formatOptions),
    metadata,
  };
}
