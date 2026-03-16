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
).pipe(
  Command.withHandler(handleDeclarativeApply),
  Command.withShortDescription("Apply a declarative SQL schema to a database"),
  Command.withDescription(
    `Apply SQL files from a declarative schema directory to a target database.

Uses pg-topo for static dependency analysis and topological ordering,
then applies statements round-by-round to handle any remaining
dependency gaps. Statements that fail with dependency errors are
deferred to subsequent rounds until all succeed or no progress is made.

Function body checks are disabled during rounds to avoid false failures
from functions referencing not-yet-created objects. A final validation
pass re-runs all function/procedure definitions with body checks enabled.
    `.trim(),
  ),
  Command.withExamples([
    {
      command:
        "pgdelta declarative apply --path ./declarative-schemas/ --target postgresql://user:pass@localhost:5432/fresh_db",
      description: "Apply an exported schema to a fresh database",
    },
    {
      command:
        "pgdelta declarative apply --path ./declarative-schemas/ --target postgresql://user:pass@localhost:5432/fresh_db --verbose",
      description:
        "Show per-round applied, deferred, and failed statement counts",
    },
    {
      command:
        "DEBUG=pg-delta:declarative-apply pgdelta declarative apply --path ./declarative-schemas/ --target postgresql://user:pass@localhost:5432/fresh_db",
      description: "Inspect defer, skip, and failure decisions with debug logs",
    },
  ]),
);
