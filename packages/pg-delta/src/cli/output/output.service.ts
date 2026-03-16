import type { Effect } from "effect";
import { ServiceMap } from "effect";
import type { NonInteractiveError } from "./errors.ts";

interface OutputApi {
  readonly stdoutColorsEnabled: boolean;
  readonly stderrColorsEnabled: boolean;
  readonly write: (message: string) => Effect.Effect<void>;
  readonly info: (message: string) => Effect.Effect<void>;
  readonly warn: (message: string) => Effect.Effect<void>;
  readonly success: (message: string) => Effect.Effect<void>;
  readonly error: (message: string) => Effect.Effect<void>;
  readonly confirm: (
    message: string,
  ) => Effect.Effect<boolean, NonInteractiveError>;
  readonly fail: (error: {
    readonly code: string;
    readonly message: string;
    readonly detail?: string;
    readonly suggestion?: string;
  }) => Effect.Effect<void>;
}

export class Output extends ServiceMap.Service<Output, OutputApi>()(
  "@pg-delta/cli/output/Output",
) {}
