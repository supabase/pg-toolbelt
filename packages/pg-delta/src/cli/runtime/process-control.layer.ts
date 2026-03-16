import { Effect, Layer } from "effect";
import { getRuntimeProcess } from "../../adapters/runtime-process.ts";
import { ProcessControl } from "./process-control.service.ts";

export const processControlLayer = Layer.effect(
  ProcessControl,
  Effect.gen(function* () {
    const runtimeProcess = yield* getRuntimeProcess();

    return ProcessControl.of({
      args: Effect.succeed(runtimeProcess.argv.slice(2)),
      env: (name: string) => Effect.succeed(runtimeProcess.env[name]),
      setExitCode: (exitCode: number) =>
        Effect.sync(() => {
          runtimeProcess.exitCode = exitCode;
        }),
      exit: (exitCode: number) =>
        Effect.sync(() => {
          runtimeProcess.exitCode = exitCode;
        }),
    });
  }),
);
