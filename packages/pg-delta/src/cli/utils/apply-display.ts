/**
 * Display utilities for the declarative-apply command.
 *
 * Pure formatting and location-resolution functions — no CLI framework dependency.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "@supabase/pg-topo";
import type { StatementError } from "../../core/declarative-apply/round-apply.ts";

/** Convert 1-based character offset in SQL to 1-based line and column. */
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

/** Parse statement id "filePath:statementIndex" into components. */
export function parseStatementId(
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

/**
 * Resolve the full path to a .sql file from schema path (dir or single file) and relative file path.
 */
export async function resolveSqlFilePath(
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
export async function formatStatementError(
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
