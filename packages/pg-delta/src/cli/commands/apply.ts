/**
 * Apply command - apply a plan's migration script to a target database.
 */

import { readFile } from "node:fs/promises";
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { applyPlan } from "../../core/plan/apply.ts";
import { deserializePlan, type Plan } from "../../core/plan/index.ts";
import { CliExitError } from "../errors.ts";
import { logError } from "../ui.ts";
import { handleApplyResult, validatePlanRisk } from "../utils.ts";

const plan = Options.text("plan").pipe(
  Options.withAlias("p"),
  Options.withDescription("Path to plan file (JSON format)"),
);

const source = Options.text("source").pipe(
  Options.withAlias("s"),
  Options.withDescription("Source database connection URL (current state)"),
);

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription("Target database connection URL (desired state)"),
);

const unsafe = Options.boolean("unsafe").pipe(
  Options.withAlias("u"),
  Options.withDescription("Allow data-loss operations (unsafe mode)"),
  Options.withDefault(false),
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
      }).pipe(Effect.tapError((e) => Effect.sync(() => logError(e.message))));

      const parsedPlan: Plan = yield* Effect.try({
        try: () => deserializePlan(planJson),
        catch: (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error parsing plan file: ${error instanceof Error ? error.message : String(error)}`,
          }),
      }).pipe(Effect.tapError((e) => Effect.sync(() => logError(e.message))));

      const validation = validatePlanRisk(parsedPlan, args.unsafe);
      if (!validation.valid) {
        return yield* Effect.fail(
          new CliExitError({
            exitCode: validation.exitCode ?? 1,
            message: "",
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
          new CliExitError({ exitCode, message: "" }),
        );
      }
    }),
);
