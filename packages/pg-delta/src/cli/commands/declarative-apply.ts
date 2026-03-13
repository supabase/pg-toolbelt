/**
 * Declarative-apply command - apply a declarative SQL schema to a database
 * using pg-topo static analysis + round-based execution.
 */

import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { loadDeclarativeSchema } from "../../core/declarative-apply/discover-sql.ts";
import {
  applyDeclarativeSchema,
  type RoundResult,
} from "../../core/declarative-apply/index.ts";
import { CliExitError } from "../errors.ts";
import { logError, logInfo, logSuccess, logWarning } from "../ui.ts";
import {
  buildDiagnosticDisplayItems,
  type DiagnosticDisplayEntry,
  formatStatementError,
  positionToLineColumn,
  requiredObjectKeyFromDiagnostic,
  resolveSqlFilePath,
} from "../utils/apply-display.ts";

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

export const declarativeApplyCommand = Command.make(
  "apply",
  {
    path: pathOpt,
    target,
    maxRounds,
    skipFunctionValidation,
    verbose,
    ungroupDiagnostics,
  },
  (args) =>
    Effect.gen(function* () {
      const maxRoundsValue = Option.getOrUndefined(args.maxRounds);

      const onRoundComplete = args.verbose
        ? (round: RoundResult) => {
            const parts = [
              `Round ${round.round}:`,
              chalk.green(`${round.applied} applied`),
            ];
            if (round.deferred > 0) {
              parts.push(chalk.yellow(`${round.deferred} deferred`));
            }
            if (round.failed > 0) {
              parts.push(chalk.red(`${round.failed} failed`));
            }
            logInfo(parts.join("  "));
          }
        : undefined;

      logInfo(`Analyzing SQL files in ${args.path}...`);

      const content = yield* Effect.tryPromise({
        try: () => loadDeclarativeSchema(args.path),
        catch: (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }),
      });

      if (content.length === 0) {
        return yield* Effect.fail(
          new CliExitError({
            exitCode: 1,
            message: `No .sql files found in '${args.path}'. Pass a directory containing .sql files or a single .sql file.`,
          }),
        );
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          applyDeclarativeSchema({
            content,
            targetUrl: args.target,
            maxRounds: maxRoundsValue,
            validateFunctionBodies: !args.skipFunctionValidation,
            onRoundComplete,
          }),
        catch: (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }),
      });

      const diagnosticDisplayOrder: Record<string, number> = {
        UNKNOWN_STATEMENT_CLASS: 0,
        DUPLICATE_PRODUCER: 1,
        CYCLE_EDGE_SKIPPED: 2,
        UNRESOLVED_DEPENDENCY: 3,
      };
      const diagnosticColor: Record<string, (s: string) => string> = {
        DUPLICATE_PRODUCER: chalk.yellow,
        CYCLE_EDGE_SKIPPED: chalk.red,
        UNRESOLVED_DEPENDENCY: chalk.dim,
      };
      const verboseOnlyCodes = new Set([
        "UNRESOLVED_DEPENDENCY",
        "DUPLICATE_PRODUCER",
        "CYCLE_EDGE_SKIPPED",
      ]);
      const warnings = result.diagnostics
        .filter(
          (d) =>
            d.code !== "UNKNOWN_STATEMENT_CLASS" &&
            (args.verbose || !verboseOnlyCodes.has(d.code)),
        )
        .sort(
          (a, b) =>
            (diagnosticDisplayOrder[a.code] ?? 99) -
            (diagnosticDisplayOrder[b.code] ?? 99),
        );
      if (warnings.length > 0 && args.verbose) {
        const fileContentCache = new Map<string, string>();
        for (const diag of warnings) {
          const id = diag.statementId;
          if (
            id &&
            id.sourceOffset != null &&
            id.filePath &&
            !fileContentCache.has(id.filePath)
          ) {
            yield* Effect.tryPromise(() =>
              resolveSqlFilePath(args.path, id.filePath).then((fullPath) =>
                readFile(fullPath, "utf-8").then((fileContent) => {
                  fileContentCache.set(id.filePath, fileContent);
                }),
              ),
            ).pipe(Effect.ignore);
          }
        }

        const entries: DiagnosticDisplayEntry[] = warnings.map((diag) => {
          let location: string | undefined;
          if (diag.statementId) {
            const id = diag.statementId;
            const offset = id.sourceOffset;
            const fileContent =
              offset != null ? fileContentCache.get(id.filePath) : undefined;
            if (fileContent != null && offset != null) {
              const { line, column } = positionToLineColumn(
                fileContent,
                offset + 1,
              );
              location = `${id.filePath}:${line}:${column}`;
            } else {
              location = `${id.filePath}:${id.statementIndex}`;
            }
          }
          return {
            diagnostic: diag,
            location,
            requiredObjectKey: requiredObjectKeyFromDiagnostic(diag),
          };
        });
        const displayItems = buildDiagnosticDisplayItems(
          entries,
          !args.ungroupDiagnostics,
        );

        const diagLines: string[] = [];
        diagLines.push(
          `\n${warnings.length} diagnostic(s) from static analysis:\n`,
        );

        let lastCode = "";
        const previewLimit = 5;
        for (const item of displayItems) {
          if (item.code !== lastCode) {
            if (lastCode !== "") {
              diagLines.push("\n");
            }
            lastCode = item.code;
          }
          const colorFn = diagnosticColor[item.code] ?? chalk.yellow;
          const location =
            item.locations.length > 0 ? ` (${item.locations[0]})` : "";
          const occurrences =
            !args.ungroupDiagnostics && item.locations.length > 1
              ? ` x${item.locations.length}`
              : "";
          diagLines.push(
            colorFn(
              `  [${item.code}]${location}${occurrences} ${item.message}\n`,
            ),
          );
          if (!args.ungroupDiagnostics && item.requiredObjectKey) {
            diagLines.push(
              colorFn(`    -> Object: ${item.requiredObjectKey}\n`),
            );
          }
          if (!args.ungroupDiagnostics && item.locations.length > 1) {
            for (const locationEntry of item.locations.slice(0, previewLimit)) {
              diagLines.push(colorFn(`    at ${locationEntry}\n`));
            }
            const remaining = item.locations.length - previewLimit;
            if (remaining > 0) {
              diagLines.push(
                colorFn(`    ... and ${remaining} more location(s)\n`),
              );
            }
          }
          if (item.suggestedFix) {
            diagLines.push(colorFn(`    -> Fix: ${item.suggestedFix}\n`));
          }
        }

        logWarning(diagLines.join(""));
      }

      const { apply } = result;

      // Summary
      const summaryParts: string[] = [];
      summaryParts.push(
        `Statements: ${result.totalStatements} total, ${apply.totalApplied} applied`,
      );
      if (apply.totalSkipped > 0) {
        summaryParts.push(`, ${apply.totalSkipped} skipped`);
      }
      logInfo(summaryParts.join(""));
      logInfo(`Rounds: ${apply.totalRounds}`);

      switch (apply.status) {
        case "success": {
          logSuccess("All statements applied successfully.");
          if (apply.validationErrors && apply.validationErrors.length > 0) {
            const errorLines: string[] = [
              `${apply.validationErrors.length} function body validation error(s):`,
            ];
            for (const err of apply.validationErrors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              errorLines.push(chalk.yellow(formatted));
              errorLines.push("");
            }
            logWarning(errorLines.join("\n"));
            return yield* Effect.fail(
              new CliExitError({
                exitCode: 1,
                message: `${apply.validationErrors.length} function body validation error(s)`,
              }),
            );
          }
          break;
        }

        case "stuck": {
          const errorLines: string[] = [
            `\nStuck after ${apply.totalRounds} round(s). ${apply.stuckStatements?.length ?? 0} statement(s) could not be applied:`,
          ];
          if (apply.stuckStatements) {
            for (const stuck of apply.stuckStatements) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(stuck, args.path),
              );
              errorLines.push(chalk.red(formatted));
              errorLines.push("");
            }
          }
          if (apply.errors && apply.errors.length > 0) {
            errorLines.push(
              `\nAdditionally, ${apply.errors.length} statement(s) had non-dependency errors:`,
            );
            for (const err of apply.errors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              errorLines.push(chalk.red(formatted));
              errorLines.push("");
            }
          }
          logError(errorLines.join("\n"));
          return yield* Effect.fail(
            new CliExitError({
              exitCode: 2,
              message: `Stuck after ${apply.totalRounds} round(s) with ${apply.stuckStatements?.length ?? 0} unresolvable statement(s)`,
            }),
          );
        }

        case "error": {
          const errorLines: string[] = [
            `\nCompleted with errors. ${apply.errors?.length ?? 0} statement(s) failed:`,
          ];
          if (apply.errors) {
            for (const err of apply.errors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              errorLines.push(chalk.red(formatted));
              errorLines.push("");
            }
          }
          if (apply.validationErrors && apply.validationErrors.length > 0) {
            errorLines.push(
              `\n${apply.validationErrors.length} function body validation error(s):`,
            );
            for (const err of apply.validationErrors) {
              const formatted = yield* Effect.promise(() =>
                formatStatementError(err, args.path),
              );
              errorLines.push(chalk.yellow(formatted));
              errorLines.push("");
            }
          }
          logError(errorLines.join("\n"));
          return yield* Effect.fail(
            new CliExitError({
              exitCode: 1,
              message: `Declarative apply completed with ${apply.errors?.length ?? 0} error(s)`,
            }),
          );
        }
      }
    }),
);
