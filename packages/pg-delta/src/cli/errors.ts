import { Data } from "effect";

/**
 * Typed CLI exit error — commands fail with this to signal a non-zero exit code.
 * The CLI runner catches it at the boundary and sets `process.exitCode`.
 *
 * Every instance **must** carry a descriptive message — never use `message: ""`.
 */
export class CliExitError extends Data.TaggedError("CliExitError")<{
  readonly exitCode: number;
  readonly message: string;
}> {}

/**
 * Non-error signal: the plan detected schema changes (exit code 2).
 * This is a CLI convention — exit 0 = no changes, exit 2 = changes detected.
 */
export class ChangesDetected extends Data.TaggedError("ChangesDetected")<{
  readonly message: string;
}> {}

/**
 * Non-error signal: the user declined a confirmation prompt (exit code 2).
 */
export class UserCancelled extends Data.TaggedError("UserCancelled")<{
  readonly message: string;
}> {}
