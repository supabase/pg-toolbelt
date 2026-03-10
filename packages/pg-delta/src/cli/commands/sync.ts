/**
 * Sync command - plan and apply changes in one go with confirmation prompt.
 */

import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { applyPlan } from "../../core/plan/apply.ts";
import { createPlan } from "../../core/plan/index.ts";
import { CliExitError, UserCancelled } from "../errors.ts";
import { logInfo } from "../ui.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import {
  formatPlanForDisplay,
  handleApplyResult,
  parseJsonEffect,
  promptConfirmation,
  validatePlanRisk,
} from "../utils.ts";

const source = Options.text("source").pipe(
  Options.withAlias("s"),
  Options.withDescription("Source database connection URL (current state)"),
);

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription("Target database connection URL (desired state)"),
);

const yes = Options.boolean("yes").pipe(
  Options.withAlias("y"),
  Options.withDescription(
    "Skip confirmation prompt and apply changes automatically",
  ),
  Options.withDefault(false),
);

const unsafe = Options.boolean("unsafe").pipe(
  Options.withAlias("u"),
  Options.withDescription("Allow data-loss operations (unsafe mode)"),
  Options.withDefault(false),
);

const role = Options.text("role").pipe(
  Options.withDescription(
    "Role to use when executing the migration (SET ROLE will be added to statements).",
  ),
  Options.optional,
);

const filter = Options.text("filter").pipe(
  Options.withDescription(
    'Filter DSL as inline JSON to filter changes (e.g., \'{"schema":"public"}\').',
  ),
  Options.optional,
);

const serialize = Options.text("serialize").pipe(
  Options.withDescription(
    'Serialize DSL as inline JSON array (e.g., \'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]\').',
  ),
  Options.optional,
);

const integration = Options.text("integration").pipe(
  Options.withDescription(
    "Integration name (e.g., 'supabase') or path to integration JSON file (must end with .json). Loads from core/integrations/ or file path.",
  ),
  Options.optional,
);

export const syncCommand = Command.make(
  "sync",
  { source, target, yes, unsafe, role, filter, serialize, integration },
  (args) =>
    Effect.gen(function* () {
      const roleValue = Option.getOrUndefined(args.role);
      const filterRaw = Option.getOrUndefined(args.filter);
      const serializeRaw = Option.getOrUndefined(args.serialize);
      const integrationValue = Option.getOrUndefined(args.integration);

      const filterParsed: FilterDSL | undefined = filterRaw
        ? yield* parseJsonEffect<FilterDSL>("filter", filterRaw)
        : undefined;
      const serializeParsed: SerializeDSL | undefined = serializeRaw
        ? yield* parseJsonEffect<SerializeDSL>("serialize", serializeRaw)
        : undefined;

      let filterOption: FilterDSL | ChangeFilter | undefined = filterParsed;
      let serializeOption: SerializeDSL | ChangeSerializer | undefined =
        serializeParsed;
      if (integrationValue) {
        const integrationDSL = yield* Effect.promise(() =>
          loadIntegrationDSL(integrationValue),
        );
        filterOption = filterOption ?? integrationDSL.filter;
        serializeOption = serializeOption ?? integrationDSL.serialize;
      }

      // 1. Create the plan
      const planResult = yield* Effect.promise(() =>
        createPlan(args.source, args.target, {
          role: roleValue,
          filter: filterOption,
          serialize: serializeOption,
        }),
      );
      if (!planResult) {
        logInfo("No changes detected.");
        return;
      }

      // 2. Display the plan
      const { content } = formatPlanForDisplay(planResult, "tree");
      logInfo(content);

      // 3. Validate risk (suppress warning since it's already shown in the plan)
      const validation = validatePlanRisk(planResult.plan, args.unsafe, {
        suppressWarning: true,
      });
      if (!validation.valid) {
        return yield* Effect.fail(
          new CliExitError({
            exitCode: validation.exitCode ?? 1,
            message:
              "Plan blocked: unsafe operations require the --unsafe flag",
          }),
        );
      }

      // 4. Prompt for confirmation (unless --yes)
      if (!args.yes) {
        const confirmed = yield* Effect.promise(() =>
          promptConfirmation("Apply these changes? (y/N) "),
        );
        if (!confirmed) {
          return yield* Effect.fail(
            new UserCancelled({ message: "Operation cancelled by user" }),
          );
        }
      }

      // 5. Apply the plan
      const result = yield* Effect.promise(() =>
        applyPlan(planResult.plan, args.source, args.target, {
          verifyPostApply: true,
        }),
      );

      // 6. Handle apply result
      const { exitCode } = handleApplyResult(result);
      if (exitCode !== 0) {
        return yield* Effect.fail(
          new CliExitError({ exitCode, message: "Plan apply failed" }),
        );
      }
    }),
);
