import { Effect, Option } from "effect";
import { applyPlan, createPlan } from "../../../effect.ts";
import { CliExitError, UserCancelled } from "../../errors.ts";
import { Output } from "../../output/output.service.ts";
import { resolveIntegration } from "../../utils/resolve-integration.ts";
import { formatPlanForDisplay, validatePlanRisk } from "../../utils.ts";

export const handleSync = Effect.fnUntraced(function* (flags: {
  readonly source: string;
  readonly target: string;
  readonly yes: boolean;
  readonly unsafe: boolean;
  readonly role: Option.Option<string>;
  readonly filter: Option.Option<string>;
  readonly serialize: Option.Option<string>;
  readonly integration: Option.Option<string>;
}) {
  const output = yield* Output;

  // Load integration if provided and extract filter/serialize DSL
  // Use integration DSL if explicit flags not provided
  const { filter, serialize } = yield* resolveIntegration({
    filter: flags.filter,
    serialize: flags.serialize,
    integration: flags.integration,
  });

  // 1. Create the plan
  const planResult = yield* createPlan(flags.source, flags.target, {
    role: Option.getOrUndefined(flags.role),
    filter,
    serialize,
  }).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error creating plan: ${error.message}`,
        }),
    ),
  );

  if (!planResult) {
    yield* output.info("No changes detected.");
    return;
  }

  // 2. Display the plan
  const { content } = yield* formatPlanForDisplay(planResult, "tree", {
    disableColors: !output.stdoutColorsEnabled,
  }).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: error.message,
        }),
    ),
  );
  yield* output.write(content);

  // 3. Validate risk (suppress warning since it's already shown in the plan)
  const validation = validatePlanRisk(planResult.plan, flags.unsafe, {
    suppressWarning: true,
  });
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

  // 4. Prompt for confirmation (unless --yes)
  if (!flags.yes) {
    const confirmed = yield* output.confirm("Apply these changes?").pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: error.detail,
          }),
      ),
    );
    if (!confirmed) {
      return yield* Effect.fail(
        new UserCancelled({ message: "Operation cancelled by user" }),
      );
    }
  }

  // 5. Apply the plan
  const result = yield* applyPlan(planResult.plan, flags.source, flags.target, {
    verifyPostApply: true,
  }).pipe(Effect.result);

  // 6. Handle apply result
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
    case "PlanApplyError":
      yield* output.error(
        `Failed to apply changes: ${result.failure.cause instanceof Error ? result.failure.cause.message : String(result.failure.cause)}`,
      );
      yield* output.error(`Migration script:\n${result.failure.script}`);
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message: `Failed to apply changes: ${result.failure.cause instanceof Error ? result.failure.cause.message : String(result.failure.cause)}`,
        }),
      );
    default:
      return yield* Effect.fail(
        new CliExitError({
          exitCode: 1,
          message: `Error applying plan: ${result.failure.message}`,
        }),
      );
  }
});
