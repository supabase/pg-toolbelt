import { validateSqlSyntax } from "@supabase/pg-topo";

/**
 * Assert that the given SQL string is syntactically valid PostgreSQL.
 *
 * Uses the PostgreSQL parser from `@supabase/pg-topo` to ensure that
 * serialized DDL statements are syntactically correct. This catches
 * issues like malformed function signatures, missing keywords, etc.
 *
 * @param sql - The SQL string to validate (typically from `change.serialize()`).
 */
export async function assertValidSql(sql: string): Promise<void> {
  try {
    await validateSqlSyntax(sql);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown parser error";
    throw new Error(`Invalid SQL syntax: ${message}\nSQL: ${sql}`);
  }
}
