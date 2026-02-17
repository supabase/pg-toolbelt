/**
 * Round-based declarative schema apply engine.
 *
 * Applies SQL statements to a database using iterative rounds:
 * 1. Try each pending statement
 * 2. On dependency errors, defer to next round
 * 3. Repeat until all applied or no progress (stuck)
 * 4. Optional final validation pass for function bodies
 */

import type { Pool, PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface RoundApplyOptions {
  /** Target database pool */
  pool: Pool;
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

// ---------------------------------------------------------------------------
// Dependency error classification
// ---------------------------------------------------------------------------

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
 * SQLSTATE codes / patterns that indicate an environment/capability limitation
 * rather than a real schema error. These statements are skipped (not retried).
 */
function isEnvironmentCapabilityError(
  code: string | undefined,
  message: string,
  statementClass: string | undefined,
): boolean {
  // Feature not supported
  if (code === "0A000") return true;

  // Extension not available
  if (
    code === "58P01" &&
    message.includes("extension") &&
    (message.includes("control file") || message.includes("is not available"))
  ) {
    return true;
  }

  // Subscription / logical replication not available
  if (
    statementClass === "CREATE_SUBSCRIPTION" &&
    (code === "58P01" ||
      message.includes("walreceiver") ||
      message.includes("logical replication"))
  ) {
    return true;
  }

  // Event trigger requires superuser
  if (
    statementClass === "CREATE_EVENT_TRIGGER" &&
    (code === "42501" || message.includes("must be superuser"))
  ) {
    return true;
  }

  // Language does not exist (e.g. plv8)
  if (
    (statementClass === "CREATE_FUNCTION" ||
      statementClass === "CREATE_PROCEDURE") &&
    message.includes("language") &&
    message.includes("does not exist")
  ) {
    return true;
  }

  // Role already exists
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

  // Sequence ownership constraint
  if (
    code === "55000" &&
    message.includes("sequence must have same owner as table it is linked to")
  ) {
    return true;
  }

  // Publication replica identity
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
}

// ---------------------------------------------------------------------------
// Core round-based apply
// ---------------------------------------------------------------------------

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
export async function roundApply(
  options: RoundApplyOptions,
): Promise<ApplyResult> {
  const {
    pool,
    statements,
    maxRounds = 100,
    disableCheckFunctionBodies = true,
    finalValidation = true,
    onRoundComplete,
  } = options;

  const rounds: RoundResult[] = [];
  const allErrors: StatementError[] = [];
  let totalApplied = 0;
  let totalSkipped = 0;

  // Track which statements still need to be applied
  let pending: StatementEntry[] = [...statements];
  // Track statements that failed with non-dependency errors
  const hardFailed: StatementError[] = [];
  // Track skipped (environment) statements
  const skipped: StatementEntry[] = [];
  // Track applied function/procedure statements for final validation
  const appliedFunctions: StatementEntry[] = [];

  const client: PoolClient = await pool.connect();

  try {
    // Disable function body checks to avoid false failures from
    // functions referencing not-yet-created objects
    if (disableCheckFunctionBodies) {
      await client.query("SET check_function_bodies = off");
    }

    for (let round = 1; round <= maxRounds && pending.length > 0; round++) {
      const roundErrors: StatementError[] = [];
      const deferred: StatementEntry[] = [];
      let appliedThisRound = 0;
      let failedThisRound = 0;

      for (const stmt of pending) {
        try {
          await client.query(stmt.sql);
          appliedThisRound++;
          totalApplied++;

          // Track functions for final validation
          if (
            stmt.statementClass === "CREATE_FUNCTION" ||
            stmt.statementClass === "CREATE_PROCEDURE"
          ) {
            appliedFunctions.push(stmt);
          }
        } catch (err) {
          const pgErr = err as PgError;
          const code = pgErr.code ?? "";
          const message = (pgErr.message ?? "").toLowerCase();

          // Check if this is an environment/capability limitation
          if (
            isEnvironmentCapabilityError(code, message, stmt.statementClass)
          ) {
            skipped.push(stmt);
            totalSkipped++;
            continue;
          }

          // Check if this is a dependency error (retryable)
          if (isDependencyError(code)) {
            deferred.push(stmt);
            roundErrors.push({
              statement: stmt,
              code,
              message: pgErr.message ?? "Unknown error",
              isDependencyError: true,
            });
            continue;
          }

          // Hard failure - non-dependency, non-environment error
          failedThisRound++;
          const stmtError: StatementError = {
            statement: stmt,
            code,
            message: pgErr.message ?? "Unknown error",
            isDependencyError: false,
          };
          roundErrors.push(stmtError);
          hardFailed.push(stmtError);
          allErrors.push(stmtError);
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

      // No progress this round - we're stuck
      if (appliedThisRound === 0 && deferred.length > 0) {
        // Collect the latest error for each stuck statement
        const stuckStatements = deferred.map((stmt) => {
          const lastError = roundErrors.find((e) => e.statement.id === stmt.id);
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
          status: "stuck",
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

    // If we exhausted maxRounds but still have pending, report stuck
    if (pending.length > 0) {
      return {
        status: "stuck",
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

    // Final validation pass: re-run functions with check_function_bodies = on
    let validationErrors: StatementError[] | undefined;
    if (finalValidation && appliedFunctions.length > 0) {
      validationErrors = await validateFunctionBodies(client, appliedFunctions);
    }

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
    };
  } finally {
    client.release();
  }
}

/**
 * Re-run CREATE FUNCTION/PROCEDURE statements with check_function_bodies = on
 * using CREATE OR REPLACE to validate function bodies after all objects exist.
 */
async function validateFunctionBodies(
  client: PoolClient,
  functions: StatementEntry[],
): Promise<StatementError[]> {
  const errors: StatementError[] = [];

  await client.query("SET check_function_bodies = on");

  for (const stmt of functions) {
    // Convert CREATE FUNCTION to CREATE OR REPLACE FUNCTION for idempotency
    const replaceSql = stmt.sql.replace(
      /^(CREATE\s+)(FUNCTION|PROCEDURE)/i,
      "$1OR REPLACE $2",
    );

    try {
      await client.query(replaceSql);
    } catch (err) {
      const pgErr = err as PgError;
      errors.push({
        statement: stmt,
        code: pgErr.code ?? "",
        message: pgErr.message ?? "Unknown validation error",
        isDependencyError: false,
      });
    }
  }

  return errors;
}
