import {
  loadModule as loadPlpgsqlParserModule,
  parseSql,
} from "plpgsql-parser";

let parserModuleLoadPromise: Promise<void> | null = null;

const ensureParserModuleLoaded = async (): Promise<void> => {
  if (!parserModuleLoadPromise) {
    parserModuleLoadPromise = loadPlpgsqlParserModule();
  }
  await parserModuleLoadPromise;
};

/**
 * Validate that a SQL string is syntactically correct using the PostgreSQL parser.
 *
 * Throws an error if the SQL cannot be parsed. This validates **syntax only**,
 * not semantic correctness (e.g. whether referenced objects exist).
 *
 * @param sql - The SQL statement to validate.
 */
export const validateSqlSyntax = async (sql: string): Promise<void> => {
  await ensureParserModuleLoaded();
  // parseSql throws on syntax errors
  parseSql(sql);
};
