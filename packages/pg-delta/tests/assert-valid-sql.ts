import { ParserServiceLive, validateSqlSyntax } from "@supabase/pg-topo";
import { Effect } from "effect";
import type { InvariantViolationError } from "../src/core/errors.ts";

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
  const resolvedSql = Effect.runSync(sql);
  const validationEffect = validateSqlSyntax(resolvedSql).pipe(
    Effect.provide(ParserServiceLive),
    Effect.mapError(
      (error) =>
        new Error(`Invalid SQL syntax: ${error.message}\nSQL: ${resolvedSql}`),
    ),
  );
  await Effect.runPromise(validationEffect);
}
