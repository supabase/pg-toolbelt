import { Effect, Layer } from "effect";
import { nodeFileSystemLayer } from "../../src/platform/node-filesystem.layer.ts";
import { ParserServiceLive } from "../../src/services/parser-live.ts";
import { makeWorkingDirectoryLayer } from "../../src/services/working-directory.ts";

const makeRuntimeLayer = (cwd: string) =>
  Layer.mergeAll(
    ParserServiceLive,
    nodeFileSystemLayer,
    makeWorkingDirectoryLayer(cwd),
  );

export const runPgTopoEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { cwd?: string },
) =>
  effect.pipe(
    Effect.provide(makeRuntimeLayer(options?.cwd ?? process.cwd())),
    Effect.runPromise,
  );
