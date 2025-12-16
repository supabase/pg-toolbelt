/**
 * SQL script formatting utilities.
 */

const STATEMENT_DELIMITER = ";\n\n";

/**
 * Format an array of SQL statements into a single script string.
 * Statements are joined with double newlines and the script ends with a semicolon.
 */
export function formatSqlScript(statements: string[]): string {
  if (statements.length === 0) return "";
  return `${statements.join(STATEMENT_DELIMITER)};`;
}
