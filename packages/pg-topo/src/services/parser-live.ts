import { Effect, Layer } from "effect";
import {
  collectExpressionDependencies,
  collectRoutineBodyDependencies,
  loadParserRuntime,
  parseSqlContentImpl,
} from "../adapters/parser-runtime.ts";
import { ParseError, WasmLoadError } from "../errors.ts";
import { ParserService } from "./parser.ts";

export const ParserServiceLive = Layer.effect(
  ParserService,
  Effect.gen(function* () {
    // Load WASM module once when the layer is built
    yield* Effect.tryPromise({
      try: () => loadParserRuntime(),
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
      collectExpressionDependencies,
      collectRoutineBodyDependencies,
    });
  }),
);
