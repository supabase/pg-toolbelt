/**
 * Declarative schema export.
 */

import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import type { Integration } from "../integrations/integration.types.ts";
import { formatSqlScript } from "../plan/statements.ts";
import { groupChangesByFile } from "./grouper.ts";
import type { DeclarativeSchemaOutput, FileEntry } from "./types.ts";

// ============================================================================
// Public API
// ============================================================================

export function exportDeclarativeSchema(
  ctx: DiffContext,
  sortedChanges: Change[],
  options?: { integration?: Integration },
): DeclarativeSchemaOutput {
  const integration = options?.integration;
  const filteredChanges = filterDeclarativeChanges(sortedChanges, integration);

  const { hash: sourceFingerprint, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    filteredChanges,
  );
  const targetFingerprint = hashStableIds(ctx.branchCatalog, stableIds);

  const groups = groupChangesByFile(filteredChanges);
  const files = groups.map((group, index) => {
    const statements = group.changes.map((change) =>
      serializeChange(change, integration),
    );
    return buildFileEntry(group.path, group.metadata, statements, index);
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

// ============================================================================
// Helpers
// ============================================================================

function filterDeclarativeChanges(
  changes: Change[],
  integration?: Integration,
): Change[] {
  const filtered = integration?.filter
    ? changes.filter((change) => integration.filter?.(change))
    : changes;

  // Declarative export targets the final state; exclude drop operations.
  return filtered.filter((change) => change.operation !== "drop");
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
