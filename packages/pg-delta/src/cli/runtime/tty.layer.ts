import { Layer } from "effect";
import {
  colorsEnabledForStream,
  getRuntimeProcess,
  isRuntimeCi,
} from "../../adapters/runtime-process.ts";
import { Tty } from "./tty.service.ts";

const runtimeProcess = getRuntimeProcess();

export const ttyLayer = Layer.succeed(Tty, {
  stdinIsTty: Boolean(runtimeProcess.stdin.isTTY),
  stdoutIsTty: Boolean(runtimeProcess.stdout.isTTY),
  stderrIsTty: Boolean(runtimeProcess.stderr.isTTY),
  isCi: isRuntimeCi(),
  stdoutColorsEnabled: colorsEnabledForStream(
    Boolean(runtimeProcess.stdout.isTTY),
  ),
  stderrColorsEnabled: colorsEnabledForStream(
    Boolean(runtimeProcess.stderr.isTTY),
  ),
});
