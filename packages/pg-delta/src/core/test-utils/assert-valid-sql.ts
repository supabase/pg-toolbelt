import { Effect } from "effect";
import { validateSqlSyntax } from "../../../../pg-topo/src/node.ts";
import type { InvariantViolationError } from "../errors.ts";

export const resolveSql = (
  sql: Effect.Effect<string, InvariantViolationError>,
): string => Effect.runSync(sql);

/**
 * Assert that the given SQL string is syntactically valid PostgreSQL.
 *
 * Uses the PostgreSQL parser from `@supabase/pg-topo` to ensure that
 * serialized DDL statements are syntactically correct. This catches
 * issues like malformed function signatures, missing keywords, etc.
 *
 * @param sql - The SQL string to validate (typically from `change.serialize()`).
 */
export async function assertValidSql(
  sql: Effect.Effect<string, InvariantViolationError>,
): Promise<void> {
  const resolvedSql = resolveSql(sql);
  try {
    await validateSqlSyntax(resolvedSql);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown parser error";
    throw new Error(`Invalid SQL syntax: ${message}\nSQL: ${resolvedSql}`);
  }
}
