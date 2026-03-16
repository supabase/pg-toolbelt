/**
 * Round-based declarative schema apply engine.
 *
 * Applies SQL statements to a database using iterative rounds:
 * 1. Try each pending statement
 * 2. On dependency errors, defer to next round
 * 3. Repeat until all applied or no progress (stuck)
 * 4. Optional final validation pass for function bodies
 */

import { Effect } from "effect";
import { getPgDeltaLogger } from "../logging.ts";
import type {
  DatabaseApi,
  DatabaseConnectionApi,
} from "../services/database.ts";

const logger = getPgDeltaLogger("declarative-apply");

export interface StatementEntry {
  /** Unique identifier for the statement (e.g. "file:index") */
  id: string;
  /** The SQL to execute */
  sql: string;
  /** Optional statement classification (e.g. CREATE_FUNCTION) */
  statementClass?: string;
}

export interface StatementError {
  /** Statement that failed */
  statement: StatementEntry;
  /** PostgreSQL error code (SQLSTATE) */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Whether this was classified as a dependency error */
  isDependencyError: boolean;
  /** 1-based character offset in the statement SQL where the error occurred */
  position?: number;
  /** PostgreSQL error detail (e.g. token invalid) */
  detail?: string;
  /** PostgreSQL hint */
  hint?: string;
}

export interface RoundResult {
  /** Round number (1-based) */
  round: number;
  /** Number of statements successfully applied this round */
  applied: number;
  /** Number of statements deferred to next round */
  deferred: number;
  /** Number of statements that failed with non-dependency errors */
  failed: number;
  /** Errors encountered this round */
  errors: StatementError[];
}

export interface ApplyResult {
  /** Overall status */
  status: "success" | "stuck" | "error";
  /** Total number of rounds executed */
  totalRounds: number;
  /** Total number of statements successfully applied */
  totalApplied: number;
  /** Total number of statements skipped (environment/capability errors) */
  totalSkipped: number;
  /** Statements that could not be applied (stuck) */
  stuckStatements?: StatementError[];
  /** Non-dependency errors that caused hard failures */
  errors?: StatementError[];
  /** Errors from the final function body validation pass */
  validationErrors?: StatementError[];
  /** Per-round results */
  rounds: RoundResult[];
}

interface RoundApplyBaseOptions {
  /** Ordered SQL statements to apply */
  statements: StatementEntry[];
  /** Max rounds before giving up (default: 100) */
  maxRounds?: number;
  /** Disable function body checks during application (default: true) */
  disableCheckFunctionBodies?: boolean;
  /** Run final validation with check_function_bodies=on (default: true) */
  finalValidation?: boolean;
  /** Progress callback fired after each round */
  onRoundComplete?: (round: RoundResult) => void;
}

export type RoundApplyOptions = RoundApplyBaseOptions & { db: DatabaseApi };

/**
 * SQLSTATE codes that indicate a missing dependency (object not yet created).
 * Mirrors pg-topo's isDependencyErrorCode.
 */
const DEPENDENCY_ERROR_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42704", // undefined_object
  "42883", // undefined_function
  "3F000", // invalid_schema_name
]);

/**
 * Detect errors caused by environment/capability limitations rather than
 * schema bugs. These statements are skipped permanently (not retried).
 *
 * Strategy: SQLSTATE codes are the primary gate (fast, stable). For codes
 * reused across unrelated error conditions (e.g. 42710 = "duplicate object"
 * covers both roles and extensions), the error message is used as a secondary
 * disambiguator. Messages are lowercased before matching to handle
 * case-sensitivity differences across PG versions.
 */
function isEnvironmentCapabilityError(
  code: string | undefined,
  message: string,
  statementClass: string | undefined,
): boolean {
  if (code === "0A000") return true;

  if (
    code === "58P01" &&
    message.includes("extension") &&
    (message.includes("control file") || message.includes("is not available"))
  ) {
    return true;
  }

  if (
    statementClass === "CREATE_SUBSCRIPTION" &&
    (code === "58P01" ||
      message.includes("walreceiver") ||
      message.includes("logical replication"))
  ) {
    return true;
  }

  if (
    statementClass === "CREATE_EVENT_TRIGGER" &&
    (code === "42501" || message.includes("must be superuser"))
  ) {
    return true;
  }

  if (
    (statementClass === "CREATE_FUNCTION" ||
      statementClass === "CREATE_PROCEDURE") &&
    message.includes("language") &&
    message.includes("does not exist")
  ) {
    return true;
  }

  if (
    statementClass === "CREATE_ROLE" &&
    (code === "42710" || code === "23505") &&
    message.includes("role") &&
    (message.includes("already exists") ||
      message.includes("duplicate key") ||
      message.includes("pg_authid_rolname_index"))
  ) {
    return true;
  }

  if (
    statementClass === "CREATE_EXTENSION" &&
    code === "42710" &&
    message.includes("extension") &&
    message.includes("already exists")
  ) {
    return true;
  }

  if (
    code === "55000" &&
    message.includes("sequence must have same owner as table it is linked to")
  ) {
    return true;
  }

  if (
    code === "55000" &&
    message.includes("does not have a replica identity") &&
    message.includes("publishes updates")
  ) {
    return true;
  }

  return false;
}

function isDependencyError(code: string | undefined): boolean {
  return code !== undefined && DEPENDENCY_ERROR_CODES.has(code);
}

interface PgError extends Error {
  code?: string;
  /** 1-based character position in query (pg may send as string) */
  position?: string | number;
  detail?: string;
  hint?: string;
}

function parsePgPosition(pos: string | number | undefined): number | undefined {
  if (pos === undefined) return undefined;
  if (typeof pos === "number" && Number.isInteger(pos) && pos > 0) return pos;
  if (typeof pos === "string") {
    const n = Number.parseInt(pos, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Apply SQL statements to a database using iterative rounds.
 *
 * Algorithm:
 * 1. Optionally set check_function_bodies = off
 * 2. For each round, iterate over pending statements:
 *    - On success: mark as applied
 *    - On dependency error: defer to next round
 *    - On environment error: skip permanently with warning
 *    - On other error: mark as failed
 * 3. If a round makes no progress (0 applied), stop (stuck)
 * 4. If finalValidation is true, re-run CREATE FUNCTION/PROCEDURE
 *    with check_function_bodies = on
 */
export const roundApply = (options: RoundApplyOptions) =>
  resolveDatabase(options).withConnection((connection) =>
    roundApplyWithClient(connection, stripDatabaseOptions(options)),
  );

function roundApplyWithClient(
  client: DatabaseConnectionApi,
  options: RoundApplyBaseOptions,
) {
  const {
    statements,
    maxRounds = 100,
    disableCheckFunctionBodies = true,
    finalValidation = true,
    onRoundComplete,
  } = options;

  const program = Effect.gen(function* () {
    const rounds: RoundResult[] = [];
    let totalApplied = 0;
    let totalSkipped = 0;

    // Pending statements are retried across rounds until they apply or we stop
    // making progress.
    let pending: StatementEntry[] = [...statements];
    // Hard failures are reported separately from deferred dependency misses.
    const hardFailed: StatementError[] = [];
    // Functions/procedures are re-run in the final validation pass once the rest
    // of the schema exists.
    const appliedFunctions: StatementEntry[] = [];

    for (let round = 1; round <= maxRounds && pending.length > 0; round += 1) {
      logger.debug("round {round}: {pending} pending", {
        round,
        pending: pending.length,
      });
      const roundErrors: StatementError[] = [];
      const deferred: StatementEntry[] = [];
      let appliedThisRound = 0;
      let failedThisRound = 0;

      for (const stmt of pending) {
        const queryResult = yield* client.query(stmt.sql).pipe(Effect.result);

        if (queryResult._tag === "Success") {
          appliedThisRound += 1;
          totalApplied += 1;

          if (
            stmt.statementClass === "CREATE_FUNCTION" ||
            stmt.statementClass === "CREATE_PROCEDURE"
          ) {
            appliedFunctions.push(stmt);
          }
          continue;
        }

        const pgErr = unwrapPgError(queryResult.failure);
        const code = pgErr.code ?? "";
        const message = (pgErr.message ?? "").toLowerCase();

        // Environment and capability issues are treated as permanent skips rather
        // than schema-ordering problems we should retry forever.
        if (isEnvironmentCapabilityError(code, message, stmt.statementClass)) {
          logger.debug("skipped {statementId}: {reason}", {
            statementId: stmt.id,
            reason: pgErr.message ?? code ?? "environment/capability",
          });
          totalSkipped += 1;
          continue;
        }

        // Dependency errors are expected when pg-topo cannot fully model a
        // runtime dependency; defer the statement to a later round.
        if (isDependencyError(code)) {
          logger.debug("deferred {statementId}: {code} - {message}", {
            statementId: stmt.id,
            code,
            message: pgErr.message ?? "Unknown error",
          });
          if (pgErr.detail) {
            logger.debug("  detail: {detail}", { detail: pgErr.detail });
          }
          if (pgErr.hint) {
            logger.debug("  hint: {hint}", { hint: pgErr.hint });
          }
          deferred.push(stmt);
          roundErrors.push({
            statement: stmt,
            code,
            message: pgErr.message ?? "Unknown error",
            isDependencyError: true,
            position: parsePgPosition(pgErr.position),
            detail: pgErr.detail,
            hint: pgErr.hint,
          });
          continue;
        }

        // Everything else is a hard failure: record it, keep going, and report it
        // in the final result.
        failedThisRound += 1;
        logger.debug("failed {statementId}: {code} - {message}", {
          statementId: stmt.id,
          code,
          message: pgErr.message ?? "Unknown error",
        });
        if (pgErr.detail) {
          logger.debug("  detail: {detail}", { detail: pgErr.detail });
        }
        if (pgErr.hint) {
          logger.debug("  hint: {hint}", { hint: pgErr.hint });
        }
        const stmtError: StatementError = {
          statement: stmt,
          code,
          message: pgErr.message ?? "Unknown error",
          isDependencyError: false,
          position: parsePgPosition(pgErr.position),
          detail: pgErr.detail,
          hint: pgErr.hint,
        };
        roundErrors.push(stmtError);
        hardFailed.push(stmtError);
      }

      if (logger.isEnabledFor("debug") && deferred.length > 0) {
        logger.debug(
          "Round {round} complete: {applied} applied, {deferred} deferred, {failed} failed",
          {
            round,
            applied: appliedThisRound,
            deferred: deferred.length,
            failed: failedThisRound,
          },
        );
        for (const error of roundErrors.filter(
          (entry) => entry.isDependencyError,
        )) {
          logger.debug("  deferred {statementId}: {code} - {message}", {
            statementId: error.statement.id,
            code: error.code,
            message: error.message,
          });
          if (error.detail) {
            logger.debug("    detail: {detail}", { detail: error.detail });
          }
          if (error.hint) {
            logger.debug("    hint: {hint}", { hint: error.hint });
          }
        }
      }

      const roundResult: RoundResult = {
        round,
        applied: appliedThisRound,
        deferred: deferred.length,
        failed: failedThisRound,
        errors: roundErrors,
      };
      rounds.push(roundResult);
      onRoundComplete?.(roundResult);

      // No applied statements plus remaining deferred work means the remaining
      // dependency gaps are no longer resolving on their own.
      if (appliedThisRound === 0 && deferred.length > 0) {
        const stuckStatements = deferred.map((stmt) => {
          const lastError = roundErrors.find(
            (error) => error.statement.id === stmt.id,
          );
          return (
            lastError ?? {
              statement: stmt,
              code: "UNKNOWN",
              message: "Deferred without a recorded error",
              isDependencyError: true,
            }
          );
        });

        return {
          status: "stuck" as const,
          totalRounds: round,
          totalApplied,
          totalSkipped,
          stuckStatements,
          errors: hardFailed.length > 0 ? hardFailed : undefined,
          rounds,
        };
      }

      pending = deferred;
    }

    // Hitting maxRounds with pending work is also a stuck condition, but we no
    // longer have round-local errors to attribute beyond the round limit itself.
    if (pending.length > 0) {
      return {
        status: "stuck" as const,
        totalRounds: maxRounds,
        totalApplied,
        totalSkipped,
        stuckStatements: pending.map((stmt) => ({
          statement: stmt,
          code: "MAX_ROUNDS",
          message: `Exceeded maximum rounds (${maxRounds})`,
          isDependencyError: true,
        })),
        errors: hardFailed.length > 0 ? hardFailed : undefined,
        rounds,
      };
    }

    // Final validation runs only after the main rounds complete, so function
    // bodies can resolve references to objects created later in the apply.
    const validationErrors =
      finalValidation && appliedFunctions.length > 0
        ? yield* validateFunctionBodies(client, appliedFunctions)
        : undefined;

    return {
      status:
        hardFailed.length > 0
          ? "error"
          : validationErrors && validationErrors.length > 0
            ? "error"
            : "success",
      totalRounds: rounds.length,
      totalApplied,
      totalSkipped,
      errors: hardFailed.length > 0 ? hardFailed : undefined,
      validationErrors:
        validationErrors && validationErrors.length > 0
          ? validationErrors
          : undefined,
      rounds,
    } satisfies ApplyResult;
  });

  if (!disableCheckFunctionBodies) {
    return program;
  }

  // Disable body checks for the main apply so CREATE FUNCTION/PROCEDURE can land
  // before every referenced object exists. Restore the session setting before
  // returning the connection to the caller.
  return client.query("SET check_function_bodies = off").pipe(
    Effect.flatMap(() => program),
    Effect.ensuring(
      client
        .query("SET check_function_bodies = on")
        .pipe(Effect.catch(() => Effect.void)),
    ),
  );
}

/**
 * Rewrite a CREATE FUNCTION/PROCEDURE statement to use OR REPLACE for
 * idempotent re-execution during validation. Handles leading line-comments,
 * block comments (pg-topo annotations), and avoids double-adding OR REPLACE.
 */
export function rewriteAsOrReplace(sql: string): string {
  return sql.replace(
    /^((?:(?:\s*--[^\n]*\n)|(?:\s*\/\*[\s\S]*?\*\/\s*))*\s*CREATE\s+)(?!OR\s+REPLACE\b)(FUNCTION|PROCEDURE)/i,
    "$1OR REPLACE $2",
  );
}

/**
 * Re-run CREATE FUNCTION/PROCEDURE statements with check_function_bodies = on
 * using CREATE OR REPLACE to validate function bodies after all objects exist.
 *
 * Runs entirely inside a transaction that is always rolled back, so:
 * - SET LOCAL search_path and check_function_bodies are transaction-scoped and
 *   never leak to the caller's session.
 * - The CREATE OR REPLACE changes are undone, leaving the DB exactly as it was
 *   after the main apply rounds.
 * - SAVEPOINTs around each statement prevent an aborted-transaction error from
 *   blocking validation of the remaining functions.
 */
function validateFunctionBodies(
  client: DatabaseConnectionApi,
  functions: StatementEntry[],
) {
  const program = Effect.gen(function* () {
    const errors: StatementError[] = [];

    // Auto-detect user schemas so unqualified names inside function bodies are
    // validated against the same broad search_path a full schema apply expects.
    const { rows } = yield* client.query<{ schemas: string | null }>(
      `
      SELECT string_agg(quote_ident(nspname), ', ' ORDER BY nspname) AS schemas
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%'
        AND nspname <> 'information_schema'
    `,
    );
    const detectedSchemas = rows[0]?.schemas;
    if (detectedSchemas) {
      logger.debug("validation search_path: {schemas}, pg_catalog", {
        schemas: detectedSchemas,
      });
      yield* client.query(
        `SET LOCAL search_path = ${detectedSchemas}, pg_catalog`,
      );
    }

    yield* client.query("SET LOCAL check_function_bodies = on");

    for (const stmt of functions) {
      const replaceSql = rewriteAsOrReplace(stmt.sql);

      // Each function gets its own savepoint so one validation error does not
      // abort the whole transaction or hide later failures.
      yield* client.query("SAVEPOINT validate_fn");
      const validationResult = yield* client
        .query(replaceSql)
        .pipe(Effect.result);

      if (validationResult._tag === "Success") {
        yield* client.query("RELEASE SAVEPOINT validate_fn");
        continue;
      }

      yield* client.query("ROLLBACK TO SAVEPOINT validate_fn");
      const pgErr = unwrapPgError(validationResult.failure);
      errors.push({
        statement: stmt,
        code: pgErr.code ?? "",
        message: pgErr.message ?? "Unknown validation error",
        isDependencyError: false,
        position: parsePgPosition(pgErr.position),
        detail: pgErr.detail,
        hint: pgErr.hint,
      });
    }

    return errors;
  });

  return client.query("BEGIN").pipe(
    Effect.flatMap(() => program),
    // Always roll back: validation should report function-body problems without
    // changing the already-applied schema definitions.
    Effect.ensuring(
      client.query("ROLLBACK").pipe(Effect.catch(() => Effect.void)),
    ),
  );
}

const resolveDatabase = (options: RoundApplyOptions): DatabaseApi => {
  return options.db;
};

const stripDatabaseOptions = (
  options: RoundApplyOptions,
): RoundApplyBaseOptions => {
  const {
    statements,
    maxRounds,
    disableCheckFunctionBodies,
    finalValidation,
    onRoundComplete,
  } = options;

  return {
    statements,
    maxRounds,
    disableCheckFunctionBodies,
    finalValidation,
    onRoundComplete,
  };
};

function unwrapPgError(error: unknown): PgError {
  let candidate = error;
  const seen = new Set<unknown>();

  while (
    typeof candidate === "object" &&
    candidate !== null &&
    !seen.has(candidate)
  ) {
    seen.add(candidate);
    const pgCandidate = candidate as PgError & { cause?: unknown };
    if (
      pgCandidate.code !== undefined ||
      pgCandidate.position !== undefined ||
      pgCandidate.detail !== undefined ||
      pgCandidate.hint !== undefined
    ) {
      return pgCandidate;
    }
    if (pgCandidate.cause === undefined) {
      return pgCandidate;
    }
    candidate = pgCandidate.cause;
  }

  if (typeof candidate === "object" && candidate !== null) {
    return candidate as PgError;
  }

  return {
    name: "PgError",
    message: String(candidate),
  };
}
