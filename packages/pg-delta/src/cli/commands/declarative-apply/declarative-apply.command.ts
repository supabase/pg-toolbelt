/**
 * Declarative-apply command - apply a declarative SQL schema to a database
 * using pg-topo static analysis + round-based execution.
 */

import { Command, Flag } from "effect/unstable/cli";
import { handleDeclarativeApply } from "./declarative-apply.handler.ts";

const pathOpt = Flag.string("path").pipe(
  Flag.withAlias("p"),
  Flag.withDescription(
    "Path to the declarative schema directory (containing .sql files) or a single .sql file",
  ),
);

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Target database connection URL to apply the schema to"),
);

const maxRounds = Flag.integer("max-rounds").pipe(
  Flag.withDescription(
    "Maximum number of application rounds before giving up (default: 100)",
  ),
  Flag.optional,
);

const skipFunctionValidation = Flag.boolean("skip-function-validation").pipe(
  Flag.withDescription("Skip final function body validation pass"),
  Flag.withDefault(false),
);

const verbose = Flag.boolean("verbose").pipe(
  Flag.withAlias("v"),
  Flag.withDescription("Show detailed per-round progress"),
  Flag.withDefault(false),
);

const ungroupDiagnostics = Flag.boolean("ungroup-diagnostics").pipe(
  Flag.withDescription(
    "Show full per-diagnostic detail instead of grouped summary output",
  ),
  Flag.withDefault(false),
);

const declarativeApplyFlags = {
  path: pathOpt,
  target,
  maxRounds,
  skipFunctionValidation,
  verbose,
  ungroupDiagnostics,
} as const;

export const declarativeApplyCommand = Command.make(
  "apply",
  declarativeApplyFlags,
).pipe(Command.withHandler(handleDeclarativeApply));
