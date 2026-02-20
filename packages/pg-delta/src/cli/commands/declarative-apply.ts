/**
 * Declarative-apply command - apply a declarative SQL schema to a database
 * using pg-topo static analysis + round-based execution.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildCommand, type CommandContext } from "@stricli/core";
import chalk from "chalk";
import { loadDeclarativeSchema } from "../../core/declarative-apply/discover-sql.ts";
import {
  applyDeclarativeSchema,
  type DeclarativeApplyResult,
  type RoundResult,
  type StatementError,
} from "../../core/declarative-apply/index.ts";

/** Convert 1-based character offset in SQL to 1-based line and column. */
function positionToLineColumn(
  sql: string,
  position: number,
): { line: number; column: number } {
  const lines = sql.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + (i < lines.length - 1 ? 1 : 0);
    if (position <= offset + lineLen) {
      return { line: i + 1, column: position - offset };
    }
    offset += lineLen;
  }
  const last = lines.length;
  const lastLineLen = lines[last - 1]?.length ?? 0;
  return { line: last, column: lastLineLen + 1 };
}

/** Parse statement id "filePath:statementIndex" into components. */
function parseStatementId(
  id: string,
): { filePath: string; statementIndex: number } | null {
  const lastColon = id.lastIndexOf(":");
  if (lastColon === -1) return null;
  const filePath = id.slice(0, lastColon);
  const n = Number.parseInt(id.slice(lastColon + 1), 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return { filePath, statementIndex: n };
}

/**
 * Resolve the full path to a .sql file from schema path (dir or single file) and relative file path.
 */
async function resolveSqlFilePath(
  schemaPath: string,
  relativeFilePath: string,
): Promise<string> {
  try {
    const statResult = await stat(schemaPath);
    const baseDir = statResult.isFile() ? path.dirname(schemaPath) : schemaPath;
    return path.join(baseDir, relativeFilePath);
  } catch {
    return path.join(schemaPath, relativeFilePath);
  }
}

/**
 * Find the 0-based start offset of statementSql in fileContent. Tries exact match, then trimmed.
 * Returns -1 if not found.
 */
function findStatementStartInFile(
  fileContent: string,
  statementSql: string,
): number {
  const exact = fileContent.indexOf(statementSql);
  if (exact !== -1) return exact;
  const trimmedStmt = statementSql.trim();
  if (!trimmedStmt) return -1;
  const trimmed = fileContent.indexOf(trimmedStmt);
  if (trimmed !== -1) return trimmed;
  return -1;
}

/**
 * Format a StatementError in pgAdmin-style. Resolves the .sql file and shows line/column in the file.
 */
async function formatStatementError(
  err: StatementError,
  schemaPath: string,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`ERROR:  ${err.message}`);
  if (err.detail) {
    lines.push(`Detail: ${err.detail}`);
  }
  lines.push(`SQL state: ${err.code}`);
  if (err.position !== undefined && err.statement.sql.length > 0) {
    lines.push(`Character: ${err.position}`);
    const pos = Math.max(
      0,
      Math.min(err.position - 1, err.statement.sql.length),
    );
    const contextStart = Math.max(0, pos - 40);
    const contextEnd = Math.min(err.statement.sql.length, pos + 40);
    const snippet = err.statement.sql.slice(contextStart, contextEnd);
    const oneLine = snippet.replace(/\s+/g, " ").trim();
    lines.push(`Context: ${oneLine || "(empty)"}`);
  }
  if (err.hint) {
    lines.push(`Hint: ${err.hint}`);
  }
  const parsed = parseStatementId(err.statement.id);
  if (parsed) {
    let locationLine: string;
    try {
      const fullPath = await resolveSqlFilePath(schemaPath, parsed.filePath);
      const fileContent = await readFile(fullPath, "utf-8");
      const statementStart = findStatementStartInFile(
        fileContent,
        err.statement.sql,
      );
      if (statementStart !== -1) {
        if (err.position !== undefined && err.statement.sql.length > 0) {
          const fileErrorOffset = statementStart + (err.position - 1);
          const fileErrorPosition = Math.min(
            fileErrorOffset + 1,
            fileContent.length,
          );
          const { line, column } = positionToLineColumn(
            fileContent,
            Math.max(1, fileErrorPosition),
          );
          locationLine = `Location: ${parsed.filePath}:${line}:${column}`;
        } else {
          const { line } = positionToLineColumn(
            fileContent,
            statementStart + 1,
          );
          locationLine = `Location: ${parsed.filePath}:${line}`;
        }
      } else {
        locationLine = `Location: ${parsed.filePath} (statement ${parsed.statementIndex})`;
      }
    } catch {
      if (err.position !== undefined && err.statement.sql.length > 0) {
        const { line, column } = positionToLineColumn(
          err.statement.sql,
          err.position,
        );
        locationLine = `Location: ${parsed.filePath} (statement ${parsed.statementIndex}, line ${line}, column ${column})`;
      } else {
        locationLine = `Location: ${parsed.filePath} (statement ${parsed.statementIndex})`;
      }
    }
    lines.push(locationLine);
  } else {
    lines.push(`Location: ${err.statement.id}`);
  }
  return lines.map((l) => `  ${l}`).join("\n");
}

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

Tip: Use DEBUG=pg-delta:declarative-apply for detailed defer/skip/fail logs (which statements are deferred and why).
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

    this.process.stdout.write(`Analyzing SQL files in ${flags.path}...\n`);

    let content: Array<{ filePath: string; sql: string }>;
    try {
      content = await loadDeclarativeSchema(flags.path);
    } catch (error) {
      this.process.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    if (content.length === 0) {
      this.process.stderr.write(
        `No .sql files found in '${flags.path}'. Pass a directory containing .sql files or a single .sql file.\n`,
      );
      process.exitCode = 1;
      return;
    }

    let result: DeclarativeApplyResult;
    try {
      result = await applyDeclarativeSchema({
        content,
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

    // Report pg-topo diagnostics grouped by severity (least noisy first).
    // UNKNOWN_STATEMENT_CLASS is always hidden; DUPLICATE_PRODUCER,
    // CYCLE_EDGE_SKIPPED, and UNRESOLVED_DEPENDENCY are verbose-only.
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
          (verbose || !verboseOnlyCodes.has(d.code)),
      )
      .sort(
        (a, b) =>
          (diagnosticDisplayOrder[a.code] ?? 99) -
          (diagnosticDisplayOrder[b.code] ?? 99),
      );
    if (warnings.length > 0 && verbose) {
      const fileContentCache = new Map<string, string>();
      for (const diag of warnings) {
        const id = diag.statementId;
        if (
          id &&
          id.sourceOffset != null &&
          id.filePath &&
          !fileContentCache.has(id.filePath)
        ) {
          try {
            const fullPath = await resolveSqlFilePath(flags.path, id.filePath);
            const content = await readFile(fullPath, "utf-8");
            fileContentCache.set(id.filePath, content);
          } catch {
            // Fall back to statementIndex display
          }
        }
      }

      this.process.stderr.write(
        chalk.yellow(
          `\n${warnings.length} diagnostic(s) from static analysis:\n`,
        ),
      );
      let lastCode = "";
      for (const diag of warnings) {
        if (diag.code !== lastCode) {
          if (lastCode !== "") {
            this.process.stderr.write("\n");
          }
          lastCode = diag.code;
        }
        const colorFn = diagnosticColor[diag.code] ?? chalk.yellow;
        let location = "";
        if (diag.statementId) {
          const id = diag.statementId;
          const offset = id.sourceOffset;
          const content =
            offset != null ? fileContentCache.get(id.filePath) : undefined;
          if (content != null && offset != null) {
            const { line, column } = positionToLineColumn(content, offset + 1);
            location = ` (${id.filePath}:${line}:${column})`;
          } else {
            location = ` (${id.filePath}:${id.statementIndex})`;
          }
        }
        this.process.stderr.write(
          colorFn(`  [${diag.code}]${location} ${diag.message}\n`),
        );
        if (diag.suggestedFix) {
          this.process.stderr.write(
            colorFn(`    -> Fix: ${diag.suggestedFix}\n`),
          );
        }
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
            const formatted = await formatStatementError(err, flags.path);
            this.process.stderr.write(chalk.yellow(formatted));
            this.process.stderr.write("\n\n");
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
            const formatted = await formatStatementError(stuck, flags.path);
            this.process.stderr.write(chalk.red(formatted));
            this.process.stderr.write("\n\n");
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
            const formatted = await formatStatementError(err, flags.path);
            this.process.stderr.write(chalk.red(formatted));
            this.process.stderr.write("\n\n");
          }
        }
        if (apply.validationErrors && apply.validationErrors.length > 0) {
          this.process.stderr.write(
            chalk.yellow(
              `\n${apply.validationErrors.length} function body validation error(s):\n`,
            ),
          );
          for (const err of apply.validationErrors) {
            const formatted = await formatStatementError(err, flags.path);
            this.process.stderr.write(chalk.yellow(formatted));
            this.process.stderr.write("\n\n");
          }
        }
        process.exitCode = 1;
        break;
      }
    }
  },
});
