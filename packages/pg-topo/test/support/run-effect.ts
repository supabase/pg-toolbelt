import { Effect, type FileSystem, Layer, type Path } from "effect";
import { makeNodeFileSystemRuntimeLayer } from "../../src/adapters/node-filesystem.ts";
import { ParserServiceLive } from "../../src/services/parser-live.ts";
import type { ParserService } from "../../src/services/parser.ts";

const makeRuntimeLayer = (cwd: string) =>
  Layer.mergeAll(ParserServiceLive, makeNodeFileSystemRuntimeLayer(cwd));

export const runPgTopoEffect = <
  A,
  E,
  R extends ParserService | FileSystem.FileSystem | Path.Path,
>(
  effect: Effect.Effect<A, E, R>,
  options?: { cwd?: string },
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(makeRuntimeLayer(options?.cwd ?? process.cwd())),
    ) as Effect.Effect<A, E, never>,
  );
