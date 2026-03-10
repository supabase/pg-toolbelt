import { Effect, Layer } from "effect";
import { loadModule as loadPlpgsqlParserModule } from "plpgsql-parser";
import { ParseError, WasmLoadError } from "../errors.ts";
import { parseSqlContentImpl } from "../ingest/parse.ts";
import { ParserService } from "./parser.ts";

export const ParserServiceLive = Layer.effect(
  ParserService,
  Effect.gen(function* () {
    // Load WASM module once when the layer is built

    yield* Effect.tryPromise({
      try: () => loadPlpgsqlParserModule(),
      catch: (err) =>
        new WasmLoadError({
          message: `Failed to load parser module: ${err}`,
          cause: err,
        }),
    });
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
