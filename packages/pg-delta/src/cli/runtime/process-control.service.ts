import type { Effect } from "effect";
import { ServiceMap } from "effect";

interface ProcessControlApi {
  readonly args: Effect.Effect<ReadonlyArray<string>>;
  readonly env: (name: string) => Effect.Effect<string | undefined>;
  readonly setExitCode: (exitCode: number) => Effect.Effect<void>;
  readonly exit: (exitCode: number) => Effect.Effect<void>;
}

export class ProcessControl extends ServiceMap.Service<
  ProcessControl,
  ProcessControlApi
>()("@pg-delta/cli/runtime/ProcessControl") {}
