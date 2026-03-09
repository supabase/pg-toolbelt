import { Effect, Layer } from "effect";
import { loadModule as loadPlpgsqlParserModule } from "plpgsql-parser";
import { ParseError, WasmLoadError } from "../errors.ts";
import { parseSqlContentImpl } from "../ingest/parse.ts";
import { ParserService } from "./parser.ts";

/**
 * Effect.once is fiber-safe and lazy — replaces the module-level
 * `let parserModuleLoadPromise: Promise<void> | null = null` singleton pattern
 * currently in parse.ts and validate-sql.ts.
 *
 * Fails with WasmLoadError (not ParseError) so callers can distinguish
 * infrastructure failures from SQL-level parse errors.
 */
const loadParser = Effect.once(
  Effect.tryPromise({
    try: () => loadPlpgsqlParserModule(),
    catch: (err) =>
      new WasmLoadError({
        message: `Failed to load parser module: ${err}`,
        cause: err,
      }),
  }),
);

export const ParserServiceLive = Layer.effect(
  ParserService,
  Effect.gen(function* () {
    // Load WASM module once when the layer is built
    yield* Effect.flatten(loadParser);
    return ParserService.of({
      parseSqlContent: (sql, sourceLabel) =>
        Effect.tryPromise({
          try: () => parseSqlContentImpl(sql, sourceLabel),
          catch: (err) =>
            new ParseError({
              message:
                err instanceof Error ? err.message : "Unknown parser error",
              filePath: sourceLabel,
              cause: err,
            }),
        }),
    });
  }),
);
