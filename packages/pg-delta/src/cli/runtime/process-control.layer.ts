import { Effect, Layer } from "effect";
import { getRuntimeProcess } from "../../adapters/runtime-process.ts";
import { ProcessControl } from "./process-control.service.ts";

export const processControlLayer = Layer.succeed(ProcessControl, {
  args: Effect.sync(() => getRuntimeProcess().argv.slice(2)),
  env: (name: string) => Effect.sync(() => getRuntimeProcess().env[name]),
  setExitCode: (exitCode: number) =>
    Effect.sync(() => {
      getRuntimeProcess().exitCode = exitCode;
    }),
  exit: (exitCode: number) =>
    Effect.sync(() => {
      getRuntimeProcess().exitCode = exitCode;
    }),
});
