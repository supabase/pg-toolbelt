import { Effect, FileSystem } from "effect";
import { deserializePlan, type Plan } from "../../../core/plan/index.ts";
import { applyPlan } from "../../../effect.ts";
import { CliExitError } from "../../errors.ts";
import { Output } from "../../output/output.service.ts";
import { validatePlanRisk } from "../../utils.ts";

export const handleApply = Effect.fnUntraced(function* (args: {
  readonly plan: string;
  readonly source: string;
  readonly target: string;
  readonly unsafe: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;

  const planJson = yield* fs.readFileString(args.plan).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error reading plan file: ${error instanceof Error ? error.message : String(error)}`,
        }),
    ),
  );

  const parsedPlan: Plan = yield* Effect.try({
    try: () => deserializePlan(planJson),
    catch: (error) =>
      new CliExitError({
        exitCode: 1,
        message: `Error parsing plan file: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

  const validation = validatePlanRisk(parsedPlan, args.unsafe);
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

  const result = yield* applyPlan(parsedPlan, args.source, args.target, {
    verifyPostApply: true,
  }).pipe(Effect.result);

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
          message: result.failure.message,
        }),
      );
    case "PlanApplyError": {
      const msg = result.failure.cause.cause;
      yield* output.error(`Failed to apply changes: ${msg}`);
      yield* output.error(`Migration script:\n${result.failure.script}`);
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
          message: `Error applying plan: ${result.failure.message}`,
        }),
      );
  }
});
