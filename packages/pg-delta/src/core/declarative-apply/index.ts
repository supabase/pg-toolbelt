/**
 * Declarative schema apply – orchestrator.
 *
 * Accepts pre-read SQL content (file path + sql string per file), uses pg-topo
 * for static dependency analysis and topological ordering, then applies
 * statements to a target database using iterative rounds to handle any
 * remaining dependency gaps. File discovery and reading are done by the caller
 * (e.g. CLI) so I/O errors can be handled there.
 */

import type { Diagnostic, StatementNode } from "@supabase/pg-topo";
import { analyzeAndSort } from "@supabase/pg-topo";
import type { Pool } from "pg";
import { createPool } from "../postgres-config.ts";
import {
  type ApplyResult,
  type RoundResult,
  roundApply,
  type StatementEntry,
} from "./round-apply.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

import type { SqlFileEntry } from "./discover-sql.ts";

interface DeclarativeApplyOptions {
  /** Pre-read SQL files: filePath (relative) and sql content. Caller does discovery and read. */
  content: SqlFileEntry[];
  /** Target database connection URL (required if pool is not provided) */
  targetUrl?: string;
  /** Existing pool to use (caller owns it; not closed). If provided, targetUrl is ignored. */
  pool?: Pool;
  /** Max rounds before giving up (default: 100) */
  maxRounds?: number;
  /** Run final function body validation (default: true) */
  validateFunctionBodies?: boolean;
  /** Disable function body checks during rounds (default: true) */
  disableCheckFunctionBodies?: boolean;
  /** Progress callback fired after each round */
  onRoundComplete?: (round: RoundResult) => void;
}

export interface DeclarativeApplyResult {
  /** Result from the round-based apply engine */
  apply: ApplyResult;
  /** Diagnostics from pg-topo's static analysis (warnings, not fatal) */
  diagnostics: Diagnostic[];
  /** Total number of statements discovered */
  totalStatements: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert pg-topo StatementNodes into StatementEntries for the apply engine.
 */
function toStatementEntries(nodes: StatementNode[]): StatementEntry[] {
  return nodes.map((node) => ({
    id: `${node.id.filePath}:${node.id.statementIndex}`,
    sql: node.sql,
    statementClass: node.statementClass,
  }));
}

function remapStatementId(
  statementId: { filePath: string; statementIndex: number } | undefined,
  filePathMap: Map<string, string>,
): typeof statementId {
  if (!statementId) return undefined;
  return {
    ...statementId,
    filePath: filePathMap.get(statementId.filePath) ?? statementId.filePath,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Apply a declarative SQL schema to a target database.
 *
 * 1. Call pg-topo analyzeAndSort on the provided SQL strings
 * 2. Remap synthetic statement IDs to caller-provided file paths
 * 3. Apply statements round-by-round to the target database
 * 4. Optionally validate function bodies in a final pass
 */
export async function applyDeclarativeSchema(
  options: DeclarativeApplyOptions,
): Promise<DeclarativeApplyResult> {
  const {
    content,
    targetUrl,
    pool: providedPool,
    maxRounds = 100,
    validateFunctionBodies = true,
    disableCheckFunctionBodies = true,
    onRoundComplete,
  } = options;

  if (content.length === 0) {
    return {
      apply: {
        status: "success",
        totalRounds: 0,
        totalApplied: 0,
        totalSkipped: 0,
        rounds: [],
      },
      diagnostics: [],
      totalStatements: 0,
    };
  }

  // Step 1: pg-topo analyze and sort (no file I/O; uses synthetic <input:i> paths)
  const sqlContents = content.map((entry) => entry.sql);
  const analyzeResult = await analyzeAndSort(sqlContents);

  const { ordered, diagnostics } = analyzeResult;

  // Step 2: Remap <input:i> to real file paths
  const filePathMap = new Map<string, string>();
  for (let i = 0; i < content.length; i += 1) {
    filePathMap.set(`<input:${i}>`, content[i].filePath);
  }

  const remappedOrdered = ordered.map((node) => ({
    ...node,
    id: {
      ...node.id,
      filePath: filePathMap.get(node.id.filePath) ?? node.id.filePath,
    },
  }));

  const remappedDiagnostics = diagnostics.map((d) => ({
    ...d,
    statementId: remapStatementId(d.statementId, filePathMap),
  }));

  if (ordered.length === 0) {
    return {
      apply: {
        status: "success",
        totalRounds: 0,
        totalApplied: 0,
        totalSkipped: 0,
        rounds: [],
      },
      diagnostics: remappedDiagnostics,
      totalStatements: 0,
    };
  }

  // Step 3: Convert to statement entries and apply
  const statements = toStatementEntries(remappedOrdered);
  let pool: Pool;
  if (providedPool != null) {
    pool = providedPool;
  } else if (targetUrl != null) {
    pool = createPool(targetUrl);
  } else {
    throw new Error("Either targetUrl or pool must be provided");
  }
  const ownsPool = providedPool == null;

  try {
    const applyResult = await roundApply({
      pool,
      statements,
      maxRounds,
      disableCheckFunctionBodies,
      finalValidation: validateFunctionBodies,
      onRoundComplete,
    });

    return {
      apply: applyResult,
      diagnostics: remappedDiagnostics,
      totalStatements: remappedOrdered.length,
    };
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

// Re-export types for convenience
export type {
  ApplyResult,
  RoundResult,
  StatementError,
} from "./round-apply.ts";
