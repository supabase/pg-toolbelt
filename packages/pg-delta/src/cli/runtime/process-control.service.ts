import type { Effect } from "effect";
import { ServiceMap } from "effect";

interface ProcessControlApi {
  readonly env: (name: string) => Effect.Effect<string | undefined>;
  readonly exit: (exitCode: number) => Effect.Effect<void>;
}

export class ProcessControl extends ServiceMap.Service<
  ProcessControl,
  ProcessControlApi
>()("@pg-delta/cli/runtime/ProcessControl") {}
