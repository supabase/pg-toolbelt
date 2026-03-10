/**
 * Apply command - apply a plan's migration script to a target database.
 */

import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { applyPlan } from "../../core/plan/apply.ts";
import { deserializePlan, type Plan } from "../../core/plan/index.ts";
import { CliExitError } from "../errors.ts";
import { handleApplyResult, validatePlanRisk } from "../utils.ts";

const plan = Flag.string("plan").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("Path to plan file (JSON format)"),
);

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Source database connection URL (current state)"),
);

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Target database connection URL (desired state)"),
);

const unsafe = Flag.boolean("unsafe").pipe(
  Flag.withAlias("u"),
  Flag.withDescription("Allow data-loss operations (unsafe mode)"),
  Flag.withDefault(false),
);

export const applyCommand = Command.make(
  "apply",
  { plan, source, target, unsafe },
  (args) =>
    Effect.gen(function* () {
      const planJson = yield* Effect.tryPromise({
        try: () => readFile(args.plan, "utf-8"),
        catch: (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error reading plan file: ${error instanceof Error ? error.message : String(error)}`,
          }),
      });

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
        return yield* Effect.fail(
          new CliExitError({
            exitCode: validation.exitCode ?? 1,
            message:
              "Plan blocked: unsafe operations require the --unsafe flag",
          }),
        );
      }

      const result = yield* Effect.promise(() =>
        applyPlan(parsedPlan, args.source, args.target, {
          verifyPostApply: true,
        }),
      );

      const { exitCode } = handleApplyResult(result);
      if (exitCode !== 0) {
        return yield* Effect.fail(
          new CliExitError({ exitCode, message: "Plan apply failed" }),
        );
      }
    }),
);
