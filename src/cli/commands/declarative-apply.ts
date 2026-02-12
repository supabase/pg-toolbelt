/**
 * Declarative-apply command - apply a declarative SQL schema to a database
 * using pg-topo static analysis + round-based execution.
 */

import { buildCommand, type CommandContext } from "@stricli/core";
import chalk from "chalk";
import {
  applyDeclarativeSchema,
  type DeclarativeApplyResult,
  type RoundResult,
} from "../../core/declarative-apply/index.ts";

export const declarativeApplyCommand = buildCommand({
  parameters: {
    flags: {
      path: {
        kind: "parsed",
        brief:
          "Path to the declarative schema directory (containing .sql files) or a single .sql file",
        parse: String,
      },
      target: {
        kind: "parsed",
        brief: "Target database connection URL to apply the schema to",
        parse: String,
      },
      "max-rounds": {
        kind: "parsed",
        brief:
          "Maximum number of application rounds before giving up (default: 100)",
        parse: Number,
        optional: true,
      },
      "no-validate-functions": {
        kind: "boolean",
        brief: "Skip final function body validation pass",
        optional: true,
      },
      verbose: {
        kind: "boolean",
        brief: "Show detailed per-round progress",
        optional: true,
      },
    },
    aliases: {
      p: "path",
      t: "target",
      v: "verbose",
    },
  },
  docs: {
    brief: "Apply a declarative SQL schema to a database",
    fullDescription: `
Apply SQL files from a declarative schema directory to a target database.

Uses pg-topo for static dependency analysis and topological ordering,
then applies statements round-by-round to handle any remaining
dependency gaps. Statements that fail with dependency errors are
deferred to subsequent rounds until all succeed or no progress is made.

Function body checks are disabled during rounds to avoid false failures
from functions referencing not-yet-created objects. A final validation
pass re-runs all function/procedure definitions with body checks enabled.

Exit codes:
  0 - Success (all statements applied)
  1 - Error (hard failures or validation errors)
  2 - Stuck (dependency cycle or unresolvable ordering)
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      path: string;
      target: string;
      "max-rounds"?: number;
      "no-validate-functions"?: boolean;
      verbose?: boolean;
    },
  ) {
    const verbose = !!flags.verbose;

    const onRoundComplete = verbose
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
          this.process.stdout.write(`${parts.join("  ")}\n`);
        }
      : undefined;

    this.process.stdout.write(
      `Analyzing SQL files in ${flags.path}...\n`,
    );

    let result: DeclarativeApplyResult;
    try {
      result = await applyDeclarativeSchema({
        schemaPath: flags.path,
        targetUrl: flags.target,
        maxRounds: flags["max-rounds"],
        validateFunctionBodies: !flags["no-validate-functions"],
        onRoundComplete,
      });
    } catch (error) {
      this.process.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    // Report pg-topo diagnostics
    const warnings = result.diagnostics.filter(
      (d) => d.code !== "UNKNOWN_STATEMENT_CLASS",
    );
    if (warnings.length > 0 && verbose) {
      this.process.stderr.write(
        chalk.yellow(`\n${warnings.length} diagnostic(s) from static analysis:\n`),
      );
      for (const diag of warnings) {
        const location = diag.statementId
          ? ` (${diag.statementId.filePath}:${diag.statementId.statementIndex})`
          : "";
        this.process.stderr.write(
          chalk.yellow(`  [${diag.code}]${location} ${diag.message}\n`),
        );
      }
      this.process.stderr.write("\n");
    }

    const { apply } = result;

    // Summary
    this.process.stdout.write("\n");
    this.process.stdout.write(
      `Statements: ${result.totalStatements} total, ${apply.totalApplied} applied`,
    );
    if (apply.totalSkipped > 0) {
      this.process.stdout.write(`, ${apply.totalSkipped} skipped`);
    }
    this.process.stdout.write("\n");
    this.process.stdout.write(`Rounds: ${apply.totalRounds}\n`);

    switch (apply.status) {
      case "success": {
        this.process.stdout.write(
          chalk.green("All statements applied successfully.\n"),
        );
        if (apply.validationErrors && apply.validationErrors.length > 0) {
          this.process.stderr.write(
            chalk.yellow(
              `\n${apply.validationErrors.length} function body validation error(s):\n`,
            ),
          );
          for (const err of apply.validationErrors) {
            this.process.stderr.write(
              chalk.yellow(
                `  [${err.code}] ${err.statement.id}: ${err.message}\n`,
              ),
            );
          }
          process.exitCode = 1;
        } else {
          process.exitCode = 0;
        }
        break;
      }

      case "stuck": {
        this.process.stderr.write(
          chalk.red(
            `\nStuck after ${apply.totalRounds} round(s). ${apply.stuckStatements?.length ?? 0} statement(s) could not be applied:\n`,
          ),
        );
        if (apply.stuckStatements) {
          for (const stuck of apply.stuckStatements) {
            this.process.stderr.write(
              chalk.red(
                `  [${stuck.code}] ${stuck.statement.id}: ${stuck.message}\n`,
              ),
            );
            if (verbose) {
              // Show the SQL for debugging
              const sqlPreview = stuck.statement.sql.slice(0, 200);
              this.process.stderr.write(
                chalk.dim(`    ${sqlPreview}${stuck.statement.sql.length > 200 ? "..." : ""}\n`),
              );
            }
          }
        }
        process.exitCode = 2;
        break;
      }

      case "error": {
        this.process.stderr.write(
          chalk.red(
            `\nCompleted with errors. ${apply.errors?.length ?? 0} statement(s) failed:\n`,
          ),
        );
        if (apply.errors) {
          for (const err of apply.errors) {
            this.process.stderr.write(
              chalk.red(
                `  [${err.code}] ${err.statement.id}: ${err.message}\n`,
              ),
            );
          }
        }
        if (apply.validationErrors && apply.validationErrors.length > 0) {
          this.process.stderr.write(
            chalk.yellow(
              `\n${apply.validationErrors.length} function body validation error(s):\n`,
            ),
          );
          for (const err of apply.validationErrors) {
            this.process.stderr.write(
              chalk.yellow(
                `  [${err.code}] ${err.statement.id}: ${err.message}\n`,
              ),
            );
          }
        }
        process.exitCode = 1;
        break;
      }
    }
  },
});
