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
import { DeclarativeApplyError } from "../errors.ts";
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
export const roundApply = (
  options: RoundApplyOptions,
): Effect.Effect<ApplyResult, DeclarativeApplyError> =>
  resolveDatabase(options)
    .withConnection((connection) =>
      roundApplyWithClient(connection, stripDatabaseOptions(options)),
    )
    .pipe(Effect.mapError(toDeclarativeApplyError));

function roundApplyWithClient(
  client: DatabaseConnectionApi,
  options: RoundApplyBaseOptions,
): Effect.Effect<ApplyResult, DeclarativeApplyError> {
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

    let pending: StatementEntry[] = [...statements];
    const hardFailed: StatementError[] = [];
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

        if (isEnvironmentCapabilityError(code, message, stmt.statementClass)) {
          logger.debug("skipped {statementId}: {reason}", {
            statementId: stmt.id,
            reason: pgErr.message ?? code ?? "environment/capability",
          });
          totalSkipped += 1;
          continue;
        }

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

  return client.query("SET check_function_bodies = off").pipe(
    Effect.mapError(toDeclarativeApplyError),
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
): Effect.Effect<StatementError[], DeclarativeApplyError> {
  const program = Effect.gen(function* () {
    const errors: StatementError[] = [];

    const { rows } = yield* client
      .query<{ schemas: string | null }>(`
      SELECT string_agg(quote_ident(nspname), ', ' ORDER BY nspname) AS schemas
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%'
        AND nspname <> 'information_schema'
    `)
      .pipe(Effect.mapError(toDeclarativeApplyError));
    const detectedSchemas = rows[0]?.schemas;
    if (detectedSchemas) {
      logger.debug("validation search_path: {schemas}, pg_catalog", {
        schemas: detectedSchemas,
      });
      yield* client
        .query(`SET LOCAL search_path = ${detectedSchemas}, pg_catalog`)
        .pipe(Effect.mapError(toDeclarativeApplyError));
    }

    yield* client
      .query("SET LOCAL check_function_bodies = on")
      .pipe(Effect.mapError(toDeclarativeApplyError));

    for (const stmt of functions) {
      const replaceSql = rewriteAsOrReplace(stmt.sql);

      yield* client
        .query("SAVEPOINT validate_fn")
        .pipe(Effect.mapError(toDeclarativeApplyError));
      const validationResult = yield* client
        .query(replaceSql)
        .pipe(Effect.result);

      if (validationResult._tag === "Success") {
        yield* client
          .query("RELEASE SAVEPOINT validate_fn")
          .pipe(Effect.mapError(toDeclarativeApplyError));
        continue;
      }

      yield* client
        .query("ROLLBACK TO SAVEPOINT validate_fn")
        .pipe(Effect.mapError(toDeclarativeApplyError));
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
    Effect.mapError(toDeclarativeApplyError),
    Effect.flatMap(() => program),
    Effect.ensuring(
      client.query("ROLLBACK").pipe(
        Effect.mapError(toDeclarativeApplyError),
        Effect.catch(() => Effect.void),
      ),
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

const toDeclarativeApplyError = (error: unknown): DeclarativeApplyError =>
  error instanceof DeclarativeApplyError
    ? error
    : new DeclarativeApplyError({
        message:
          error instanceof Error
            ? error.message
            : `roundApply failed: ${String(error)}`,
        cause: error,
      });

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
