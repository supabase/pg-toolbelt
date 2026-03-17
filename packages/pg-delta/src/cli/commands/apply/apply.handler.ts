import { Effect, FileSystem } from "effect";
import { deserializePlan, type Plan } from "../../../core/plan/index.ts";
import { applyPlan } from "../../../effect.ts";
import { CliExitError } from "../../errors.ts";
import {
  displayAndValidateRisk,
  handleApplyResult,
} from "../../utils/handle-apply-result.ts";

export const handleApply = Effect.fnUntraced(function* (args: {
  readonly plan: string;
  readonly source: string;
  readonly target: string;
  readonly unsafe: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;

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

  yield* displayAndValidateRisk(parsedPlan, args.unsafe);

  const result = yield* applyPlan(parsedPlan, args.source, args.target, {
    verifyPostApply: true,
  }).pipe(Effect.result);

  yield* handleApplyResult(result);
});
