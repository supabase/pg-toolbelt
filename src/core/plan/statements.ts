/**
 * SQL script formatting utilities.
 */

import { formatSqlStatements, type SqlFormatOptions } from "./sql-format.ts";

const STATEMENT_DELIMITER = ";\n\n";

/**
 * Format an array of SQL statements into a single script string.
 * Statements are joined with double newlines and the script ends with a semicolon.
 */
export function formatSqlScript(
  statements: string[],
  options?: SqlFormatOptions,
): string {
  if (statements.length === 0) return "";
  const formatted = options
    ? formatSqlStatements(statements, options)
    : statements;
  return `${formatted.join(STATEMENT_DELIMITER)};`;
}
