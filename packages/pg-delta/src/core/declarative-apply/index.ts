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
import { analyzeAndSort, ParserServiceLive } from "@supabase/pg-topo";
import { Effect } from "effect";
import { DeclarativeApplyError } from "../errors.ts";
import type { DatabaseApi } from "../services/database.ts";
import { DatabaseResolver } from "../services/database-resolver.ts";
import { extractCatalogProviders } from "./extract-catalog-providers.ts";
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
  /** Existing database adapter to use. If provided, targetUrl is ignored. */
  pool?: DatabaseApi;
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
 * 1. Call pg-topo analyzeAndSort on the provided SQL strings
 * 2. Remap synthetic statement IDs to caller-provided file paths
 * 3. Apply statements round-by-round to the target database
 * 4. Optionally validate function bodies in a final pass
 */
export type { SqlFileEntry } from "./discover-sql.ts";

// Re-export file discovery for programmatic callers (e.g. Supabase CLI edge-runtime templates)
export { loadDeclarativeSchema } from "./discover-sql.ts";
// Re-export result types for callers that need them (StatementError is imported from round-apply directly where needed)
export type { ApplyResult, RoundResult } from "./round-apply.ts";

export const applyDeclarativeSchema = (options: DeclarativeApplyOptions) => {
  const {
    content,
    maxRounds = 100,
    validateFunctionBodies = true,
    disableCheckFunctionBodies = true,
    onRoundComplete,
  } = options;

  if (content.length === 0) {
    return Effect.succeed(emptyApplyResult([]));
  }

  return withResolvedDatabase(options, (db) =>
    Effect.gen(function* () {
      const externalProviders = yield* extractCatalogProviders(db).pipe(
        Effect.mapError(
          (error) =>
            new DeclarativeApplyError({
              message: error.message,
              cause: error,
            }),
        ),
      );

      const analyzeResult = yield* analyzeAndSort(
        content.map((entry) => entry.sql),
        { externalProviders },
      ).pipe(
        Effect.provide(ParserServiceLive),
        Effect.mapError(
          (error) =>
            new DeclarativeApplyError({
              message: `Failed to analyze declarative SQL: ${error.message}`,
              cause: error,
            }),
        ),
      );

      const { ordered, diagnostics } = analyzeResult;
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

      const remappedDiagnostics = diagnostics.map((diagnostic) => ({
        ...diagnostic,
        statementId: diagnostic.statementId && {
          ...diagnostic.statementId,
          filePath:
            filePathMap.get(diagnostic.statementId.filePath) ??
            diagnostic.statementId.filePath,
        },
      }));

      if (ordered.length === 0) {
        return emptyApplyResult(remappedDiagnostics);
      }

      const applyResult = yield* roundApply({
        db,
        statements: toStatementEntries(remappedOrdered),
        maxRounds,
        disableCheckFunctionBodies,
        finalValidation: validateFunctionBodies,
        onRoundComplete,
      }).pipe(
        Effect.mapError((error) => {
          return new DeclarativeApplyError({
            message: error.message,
            cause: error,
          });
        }),
      );

      return {
        apply: applyResult,
        diagnostics: remappedDiagnostics,
        totalStatements: remappedOrdered.length,
      };
    }),
  );
};

const emptyApplyResult = (
  diagnostics: Diagnostic[],
): DeclarativeApplyResult => ({
  apply: {
    status: "success",
    totalRounds: 0,
    totalApplied: 0,
    totalSkipped: 0,
    rounds: [],
  },
  diagnostics,
  totalStatements: 0,
});

export const withResolvedDatabase = <A, E, R>(
  options: DeclarativeApplyOptions,
  use: (database: DatabaseApi) => Effect.Effect<A, E, R>,
): Effect.Effect<A, DeclarativeApplyError | E, R> => {
  const { targetUrl, pool: providedPool } = options;

  if (providedPool) {
    return use(providedPool);
  }

  if (!targetUrl) {
    return Effect.fail(
      new DeclarativeApplyError({
        message: "Either targetUrl or pool must be provided",
      }),
    );
  }

  return Effect.scoped(
    Effect.gen(function* () {
      const databaseResolver = yield* DatabaseResolver;
      const database = yield* databaseResolver
        .fromConnectionString(targetUrl, { label: "target" })
        .pipe(
          Effect.mapError(
            (error) =>
              new DeclarativeApplyError({
                message: error.message,
                cause: error,
              }),
          ),
        );
      return yield* use(database);
    }),
  );
};
