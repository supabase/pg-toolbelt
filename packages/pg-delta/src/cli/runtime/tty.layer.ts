import { Effect, Layer } from "effect";
import {
  colorsEnabledForRuntimeProcess,
  getRuntimeProcess,
  isRuntimeCi,
} from "../../adapters/runtime-process.ts";
import { Tty } from "./tty.service.ts";

export const ttyLayer = Layer.effect(
  Tty,
  Effect.gen(function* () {
    const runtimeProcess = yield* getRuntimeProcess();

    return Tty.of({
      stdinIsTty: Boolean(runtimeProcess.stdin.isTTY),
      stdoutIsTty: Boolean(runtimeProcess.stdout.isTTY),
      stderrIsTty: Boolean(runtimeProcess.stderr.isTTY),
      isCi: isRuntimeCi(runtimeProcess),
      stdoutColorsEnabled: colorsEnabledForRuntimeProcess(
        runtimeProcess,
        Boolean(runtimeProcess.stdout.isTTY),
      ),
      stderrColorsEnabled: colorsEnabledForRuntimeProcess(
        runtimeProcess,
        Boolean(runtimeProcess.stderr.isTTY),
      ),
    });
  }),
);
