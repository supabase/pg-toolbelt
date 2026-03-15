/**
 * Display utilities for the declarative-apply command.
 */

import path from "node:path";
import type { Diagnostic } from "@supabase/pg-topo";
import chalk from "chalk";
import { Effect, FileSystem } from "effect";
import type { RoundResult } from "../../core/declarative-apply/index.ts";
import type { StatementError } from "../../core/declarative-apply/round-apply.ts";

export function positionToLineColumn(
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

export type DiagnosticDisplayEntry = {
  diagnostic: Diagnostic;
  location?: string;
  requiredObjectKey?: string;
};

export type DiagnosticDisplayItem = {
  code: string;
  message: string;
  suggestedFix?: string;
  requiredObjectKey?: string;
  locations: string[];
};

export const requiredObjectKeyFromDiagnostic = (
  diagnostic: Diagnostic,
): string | undefined => {
  const value = diagnostic.details?.requiredObjectKey;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const diagnosticDisplayGroupKey = (entry: DiagnosticDisplayEntry): string =>
  [
    entry.diagnostic.code,
    entry.diagnostic.message,
    entry.diagnostic.suggestedFix ?? "",
    entry.requiredObjectKey ?? "",
  ].join("\u0000");

export const buildDiagnosticDisplayItems = (
  entries: DiagnosticDisplayEntry[],
  grouped: boolean,
): DiagnosticDisplayItem[] => {
  if (!grouped) {
    return entries.map((entry) => ({
      code: entry.diagnostic.code,
      message: entry.diagnostic.message,
      suggestedFix: entry.diagnostic.suggestedFix,
      requiredObjectKey: entry.requiredObjectKey,
      locations: entry.location ? [entry.location] : [],
    }));
  }

  const groupedItems = new Map<string, DiagnosticDisplayItem>();
  for (const entry of entries) {
    const key = diagnosticDisplayGroupKey(entry);
    const existing = groupedItems.get(key);
    if (!existing) {
      groupedItems.set(key, {
        code: entry.diagnostic.code,
        message: entry.diagnostic.message,
        suggestedFix: entry.diagnostic.suggestedFix,
        requiredObjectKey: entry.requiredObjectKey,
        locations: entry.location ? [entry.location] : [],
      });
      continue;
    }
    if (entry.location && !existing.locations.includes(entry.location)) {
      existing.locations.push(entry.location);
    }
  }
  return [...groupedItems.values()];
};

export const resolveSqlFilePath = (
  schemaPath: string,
  relativeFilePath: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const statResult = yield* fs
      .stat(schemaPath)
      .pipe(Effect.orElseSucceed(() => undefined));
    const baseDir =
      statResult?.type === "File" ? path.dirname(schemaPath) : schemaPath;
    return path.join(baseDir, relativeFilePath);
  });

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

export const formatStatementError = (
  err: StatementError,
  schemaPath: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
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
      const fullPath = yield* resolveSqlFilePath(schemaPath, parsed.filePath);
      const fileContent = yield* fs
        .readFileString(fullPath, "utf-8")
        .pipe(Effect.orElseSucceed(() => undefined));

      if (fileContent !== undefined) {
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
      } else if (err.position !== undefined && err.statement.sql.length > 0) {
        const { line, column } = positionToLineColumn(
          err.statement.sql,
          err.position,
        );
        locationLine = `Location: ${parsed.filePath} (statement ${parsed.statementIndex}, line ${line}, column ${column})`;
      } else {
        locationLine = `Location: ${parsed.filePath} (statement ${parsed.statementIndex})`;
      }
      lines.push(locationLine);
    } else {
      lines.push(`Location: ${err.statement.id}`);
    }

    return lines.map((line) => `  ${line}`).join("\n");
  });

const identity = (value: string) => value;

export function formatRoundStatus(
  round: RoundResult,
  useColors: boolean,
): string {
  const green = useColors ? chalk.green : identity;
  const yellow = useColors ? chalk.yellow : identity;
  const red = useColors ? chalk.red : identity;
  const parts = [`Round ${round.round}:`, green(`${round.applied} applied`)];
  if (round.deferred > 0) parts.push(yellow(`${round.deferred} deferred`));
  if (round.failed > 0) parts.push(red(`${round.failed} failed`));
  return parts.join("  ");
}

const diagnosticColorMap: Record<string, (value: string) => string> = {
  DUPLICATE_PRODUCER: chalk.yellow,
  CYCLE_EDGE_SKIPPED: chalk.red,
  UNRESOLVED_DEPENDENCY: chalk.dim,
};

export function formatDiagnosticsBlock(
  items: DiagnosticDisplayItem[],
  warningCount: number,
  options: {
    useColors: boolean;
    ungroupDiagnostics: boolean;
    previewLimit?: number;
  },
): string {
  const { useColors, ungroupDiagnostics, previewLimit = 5 } = options;
  const defaultColor = useColors ? chalk.yellow : identity;
  const lines: string[] = [
    `\n${warningCount} diagnostic(s) from static analysis:\n`,
  ];

  let lastCode = "";
  for (const item of items) {
    if (item.code !== lastCode) {
      if (lastCode !== "") {
        lines.push("\n");
      }
      lastCode = item.code;
    }

    const colorFn = useColors
      ? (diagnosticColorMap[item.code] ?? defaultColor)
      : identity;
    const location = item.locations.length > 0 ? ` (${item.locations[0]})` : "";
    const occurrences =
      !ungroupDiagnostics && item.locations.length > 1
        ? ` x${item.locations.length}`
        : "";
    lines.push(
      colorFn(`  [${item.code}]${location}${occurrences} ${item.message}\n`),
    );

    if (!ungroupDiagnostics && item.requiredObjectKey) {
      lines.push(colorFn(`    -> Object: ${item.requiredObjectKey}\n`));
    }
    if (!ungroupDiagnostics && item.locations.length > 1) {
      for (const locationEntry of item.locations.slice(0, previewLimit)) {
        lines.push(colorFn(`    at ${locationEntry}\n`));
      }
      const remaining = item.locations.length - previewLimit;
      if (remaining > 0) {
        lines.push(colorFn(`    ... and ${remaining} more location(s)\n`));
      }
    }
    if (item.suggestedFix) {
      lines.push(colorFn(`    -> Fix: ${item.suggestedFix}\n`));
    }
  }

  return lines.join("");
}

export function colorStatementError(
  formatted: string,
  severity: "error" | "warning",
  useColors: boolean,
): string {
  if (!useColors) return formatted;
  return severity === "error" ? chalk.red(formatted) : chalk.yellow(formatted);
}
