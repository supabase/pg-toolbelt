import { ServiceMap } from "effect";

interface TtyApi {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly stderrIsTty: boolean;
  readonly isCi: boolean;
  readonly stdoutColorsEnabled: boolean;
  readonly stderrColorsEnabled: boolean;
}

export class Tty extends ServiceMap.Service<Tty, TtyApi>()(
  "@pg-delta/cli/runtime/Tty",
) {}
