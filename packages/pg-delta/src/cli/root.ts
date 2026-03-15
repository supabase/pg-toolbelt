import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { applyCommand } from "./commands/apply/apply.command.ts";
import { catalogExportCommand } from "./commands/catalog-export/catalog-export.command.ts";
import { declarativeApplyCommand } from "./commands/declarative-apply/declarative-apply.command.ts";
import { declarativeExportCommand } from "./commands/declarative-export/declarative-export.command.ts";
import { planCommand } from "./commands/plan/plan.command.ts";
import { syncCommand } from "./commands/sync/sync.command.ts";
import { OutputFormatFlag } from "./global-flags.ts";
import { outputLayerFor } from "./output/output.layer.ts";

const declarativeCommand = Command.make("declarative").pipe(
  Command.withSubcommands([declarativeApplyCommand, declarativeExportCommand]),
);

export const root = Command.make("pgdelta").pipe(
  Command.withSubcommands([
    planCommand,
    applyCommand,
    syncCommand,
    declarativeCommand,
    catalogExportCommand,
  ]),
  Command.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const outputFormat = yield* OutputFormatFlag;
        return outputLayerFor(outputFormat);
      }),
    ),
  ),
  Command.withGlobalFlags([OutputFormatFlag]),
);
