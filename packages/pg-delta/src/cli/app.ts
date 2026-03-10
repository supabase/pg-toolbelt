import { Command } from "@effect/cli";
import { applyCommand } from "./commands/apply.ts";
import { catalogExportCommand } from "./commands/catalog-export.ts";
import { declarativeApplyCommand } from "./commands/declarative-apply.ts";
import { declarativeExportCommand } from "./commands/declarative-export.ts";
import { planCommand } from "./commands/plan.ts";
import { syncCommand } from "./commands/sync.ts";

const declarativeCommand = Command.make("declarative").pipe(
  Command.withSubcommands([declarativeApplyCommand, declarativeExportCommand]),
);

export const rootCommand = Command.make("pgdelta").pipe(
  Command.withSubcommands([
    planCommand,
    applyCommand,
    syncCommand,
    declarativeCommand,
    catalogExportCommand,
  ]),
);
