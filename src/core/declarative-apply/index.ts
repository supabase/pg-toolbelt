/**
 * Declarative schema apply – orchestrator.
 *
 * Reads SQL files from a directory, uses pg-topo for static dependency
 * analysis and topological ordering, then applies statements to a target
 * database using iterative rounds to handle any remaining dependency gaps.
 */

import type { Diagnostic, StatementNode } from "@supabase/pg-topo";
import { analyzeAndSortFromFiles } from "@supabase/pg-topo";
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

export interface DeclarativeApplyOptions {
  /** Path to the SQL files directory (or a single .sql file) */
  schemaPath: string;
  /** Target database connection URL */
  targetUrl: string;
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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Apply a declarative SQL schema to a target database.
 *
 * 1. Discover and parse SQL files using pg-topo
 * 2. Build dependency graph and compute topological order
 * 3. Apply statements round-by-round to the target database
 * 4. Optionally validate function bodies in a final pass
 */
export async function applyDeclarativeSchema(
  options: DeclarativeApplyOptions,
): Promise<DeclarativeApplyResult> {
  const {
    schemaPath,
    targetUrl,
    maxRounds = 100,
    validateFunctionBodies = true,
    disableCheckFunctionBodies = true,
    onRoundComplete,
  } = options;

  // Step 1: Use pg-topo to analyze and sort the SQL files
  const analyzeResult = await analyzeAndSortFromFiles([schemaPath]);

  const { ordered, diagnostics } = analyzeResult;

  if (ordered.length === 0) {
    return {
      apply: {
        status: "success",
        totalRounds: 0,
        totalApplied: 0,
        totalSkipped: 0,
        rounds: [],
      },
      diagnostics,
      totalStatements: 0,
    };
  }

  // Step 2: Convert to statement entries
  const statements = toStatementEntries(ordered);

  // Step 3: Connect to target database and apply
  const pool = createPool(targetUrl);

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
      diagnostics,
      totalStatements: ordered.length,
    };
  } finally {
    await pool.end();
  }
}

// Re-export types for convenience
export type {
  ApplyResult,
  RoundResult,
  StatementEntry,
  StatementError,
} from "./round-apply.ts";
