import { normalizePlan, planUnits } from "./normalize.ts";
import type { SqlFormatOptions } from "./sql-format.ts";
import { formatSqlStatements } from "./sql-format.ts";
import type { MigrationUnit, Plan } from "./types.ts";

const STATEMENT_DELIMITER = ";\n\n";

export interface RenderPlanSqlOptions {
  sqlFormatOptions?: SqlFormatOptions;
  includeTransactions?: boolean;
}

export interface RenderedPlanFile {
  path: string;
  sql: string;
  unit: MigrationUnit;
}

export function renderPlanSql(
  plan: Plan,
  options: RenderPlanSqlOptions = {},
): string {
  const normalized = normalizePlan(plan);
  const units = normalized.units;
  if (units.length === 0) return "";

  return units
    .map((unit, index) =>
      renderUnitSql(normalized, unit, {
        ...options,
        unitIndex: index,
        includeFileHeader: true,
      }),
    )
    .join("\n\n");
}

export function renderPlanFiles(
  plan: Plan,
  options: RenderPlanSqlOptions = {},
): RenderedPlanFile[] {
  const normalized = normalizePlan(plan);
  return normalized.units.map((unit, index) => ({
    path: `${String(index + 1).padStart(3, "0")}_${slugify(unit.name)}.sql`,
    sql: renderUnitSql(normalized, unit, {
      ...options,
      unitIndex: index,
      includeFileHeader: true,
    }),
    unit,
  }));
}

export function flattenPlanStatements(plan: Plan): string[] {
  const units = planUnits(plan);
  if (units.length === 0) return plan.statements;
  return units.flatMap((unit) => unit.statements.map((stmt) => stmt.sql));
}

function renderUnitSql(
  plan: Plan,
  unit: MigrationUnit,
  options: RenderPlanSqlOptions & {
    unitIndex: number;
    includeFileHeader: boolean;
  },
): string {
  const includeTransactions = options.includeTransactions !== false;
  const statements = unit.statements.map((stmt) => stmt.sql);
  const body =
    options.sqlFormatOptions != null
      ? formatSqlStatements(statements, options.sqlFormatOptions)
      : statements;

  const lines: string[] = [];
  if (options.includeFileHeader) {
    lines.push(`-- Migration unit ${options.unitIndex + 1}: ${unit.name}`);
    lines.push(`-- Transaction mode: ${unit.transactionMode}`);
    lines.push(`-- Boundary reason: ${unit.reason}`);
    lines.push("");
  }

  const sessionStatements = plan.sessionStatements ?? [];
  if (sessionStatements.length > 0) {
    lines.push(renderStatements(sessionStatements));
    lines.push("");
  }

  if (includeTransactions && unit.transactionMode === "transactional") {
    lines.push("BEGIN;");
    lines.push("");
  }

  lines.push(renderStatements(body));

  if (includeTransactions && unit.transactionMode === "transactional") {
    lines.push("");
    lines.push("COMMIT;");
  }

  return lines.join("\n").trimEnd();
}

function renderStatements(statements: string[]): string {
  if (statements.length === 0) return "";
  return `${statements.map(trimTerminator).join(STATEMENT_DELIMITER)};`;
}

function trimTerminator(statement: string): string {
  const trimmed = statement.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 59) {
    end--;
  }
  return trimmed.slice(0, end);
}

function slugify(value: string): string {
  let slug = "";
  let previousWasSeparator = false;
  for (const char of value.toLowerCase()) {
    if (isAsciiLetterOrDigit(char)) {
      slug += char;
      previousWasSeparator = false;
    } else if (!previousWasSeparator) {
      slug += "_";
      previousWasSeparator = true;
    }
  }

  let start = 0;
  let end = slug.length;
  while (start < end && slug.charCodeAt(start) === 95) {
    start++;
  }
  while (end > start && slug.charCodeAt(end - 1) === 95) {
    end--;
  }
  return slug.slice(start, end) || "migration";
}

function isAsciiLetterOrDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}
