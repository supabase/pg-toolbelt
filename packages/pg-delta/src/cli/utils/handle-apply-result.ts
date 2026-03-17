import { Effect, type Result } from "effect";
import type { Plan } from "../../core/plan/types.ts";
import { CliExitError } from "../errors.ts";
import { extractDeepestCliMessage } from "../output/normalize-error.ts";
import { Output } from "../output/output.service.ts";
import { validatePlanRisk } from "../utils.ts";

type ApplyResult = Result.Result<
  { statements: number; warnings?: string[] },
  { _tag: string; message?: string; cause?: unknown; script?: string }
>;

export const handleApplyResult = Effect.fnUntraced(function* (
  result: ApplyResult,
) {
  const output = yield* Output;

  if (result._tag === "Success") {
    yield* output.info(
      `Applying ${result.success.statements} changes to database...`,
    );
    yield* output.info("Successfully applied all changes.");
    for (const warning of result.success.warnings ?? []) {
      yield* output.warn(`Warning: ${warning}`);
    }
    return;
  }

  switch (result.failure._tag) {
    case "AlreadyAppliedError":
      yield* output.info(
        "Plan already applied (target fingerprint matches desired state).",
      );
      return;
    case "FingerprintMismatchError":
      yield* output.error(
        "Target database does not match plan source fingerprint. Aborting.",
      );
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message:
            "Target database does not match plan source fingerprint. Aborting.",
          alreadyReported: true,
        }),
      );
    case "InvalidPlanError":
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message: result.failure.message ?? "Invalid plan",
        }),
      );
    case "PlanApplyError": {
      const msg = extractDeepestCliMessage(result.failure.cause);
      yield* output.error(`Failed to apply changes: ${msg}`);
      yield* output.error(`Migration script:\n${result.failure.script ?? ""}`);
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message: `Failed to apply changes: ${msg}`,
          alreadyReported: true,
        }),
      );
    }
    default:
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message: `Error applying plan: ${result.failure.message ?? "Unknown error"}`,
        }),
      );
  }
});

export const displayAndValidateRisk = Effect.fnUntraced(function* (
  plan: Plan,
  unsafe: boolean,
  options?: { suppressWarning?: boolean },
) {
  const output = yield* Output;
  const validation = validatePlanRisk(plan, unsafe, options);

  if (!validation.valid) {
    const warning = validation.warning;
    if (warning) {
      yield* output.warn(warning.title);
      for (const statement of warning.statements) {
        yield* output.warn(`- ${statement}`);
      }
      yield* output.warn(warning.suggestion);
    }
    return yield* Effect.fail(
      new CliExitError({
        exitCode: validation.exitCode,
        message: validation.message,
      }),
    );
  }
});
