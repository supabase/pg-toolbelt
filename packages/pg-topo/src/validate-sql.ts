import { Effect, ManagedRuntime } from "effect";
import { ValidationError } from "./errors.ts";
import { ParserService } from "./services/parser.ts";
import { ParserServiceLive } from "./services/parser-live.ts";

/**
 * Module-level managed runtime — shared with parse.ts. Lazily builds
 * ParserServiceLive on first use; WASM loading happens once via Effect.once.
 */
const parserRuntime = ManagedRuntime.make(ParserServiceLive);

/**
 * Validate that a SQL string is syntactically correct using the PostgreSQL parser.
 *
 * Throws an error if the SQL cannot be parsed. This validates **syntax only**,
 * not semantic correctness (e.g. whether referenced objects exist).
 *
 * Routes through ParserService so WASM module loading is managed by the service layer.
 *
 * @param sql - The SQL statement to validate.
 */
export const validateSqlSyntax = async (sql: string): Promise<void> => {
  await parserRuntime.runPromise(
    Effect.gen(function* () {
      const parser = yield* ParserService;
      // Use the parser to load/validate the module, then call parseSql directly
      // since parseSqlContent returns parsed statements, but we just need syntax validation.
      yield* parser.parseSqlContent(sql, "<validation>").pipe(Effect.asVoid);
    }),
  );
};

// ============================================================================
// Effect-native version
// ============================================================================

/**
 * Validate SQL syntax using the ParserService. The WASM module loading
 * is handled by the service layer.
 */
export const validateSqlSyntaxEffect = (
  sql: string,
): Effect.Effect<void, ValidationError, ParserService> =>
  Effect.gen(function* () {
    const parser = yield* ParserService;
    yield* parser
      .parseSqlContent(sql, "<validation>")
      .pipe(
        Effect.mapError(
          (e) => new ValidationError({ message: e.message, cause: e }),
        ),
      );
  });
