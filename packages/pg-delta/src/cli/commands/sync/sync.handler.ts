import { Effect, Option } from "effect";
import { applyPlan, createPlan } from "../../../effect.ts";
import { CliExitError, UserCancelled } from "../../errors.ts";
import { Output } from "../../output/output.service.ts";
import {
  displayAndValidateRisk,
  handleApplyResult,
} from "../../utils/handle-apply-result.ts";
import { resolveIntegration } from "../../utils/resolve-integration.ts";
import { formatPlanForDisplay } from "../../utils.ts";

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
  yield* displayAndValidateRisk(planResult.plan, flags.unsafe, {
    suppressWarning: true,
  });

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
  yield* handleApplyResult(result);
});
