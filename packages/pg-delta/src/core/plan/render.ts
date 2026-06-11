/**
 * Plan rendering - turn migration units into executable SQL scripts.
 */

import { normalizePlan } from "./normalize.ts";
import type { SqlFormatOptions } from "./sql-format.ts";
import { formatSqlStatements } from "./sql-format.ts";
import type {
  ExecutionBoundaryReason,
  MigrationUnit,
  Plan,
  SerializedPlan,
} from "./types.ts";

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

/**
 * Render the whole plan as a single SQL script. Each migration unit is
 * delimited with header comments and, for transactional units, wrapped in
 * explicit BEGIN/COMMIT.
 */
export function renderPlanSql(
  plan: SerializedPlan,
  options: RenderPlanSqlOptions = {},
): string {
  const normalized = normalizePlan(plan);
  return normalized.units
    .map((unit, index) => renderUnitSql(normalized, unit, index, options))
    .join("\n\n");
}

/**
 * Render the plan as one numbered SQL file per migration unit. Session
 * statements are repeated in every file because each file may be executed
 * in its own session.
 */
export function renderPlanFiles(
  plan: SerializedPlan,
  options: RenderPlanSqlOptions = {},
): RenderedPlanFile[] {
  const normalized = normalizePlan(plan);
  return normalized.units.map((unit, index) => ({
    path: `${String(index + 1).padStart(3, "0")}_${unitName(unit.reason)}.sql`,
    sql: renderUnitSql(normalized, unit, index, options),
    unit,
  }));
}

/**
 * Flatten a plan back into the ordered statement list, session statements
 * included. Execution context (transaction boundaries) is lost — use
 * `renderPlanSql`/`renderPlanFiles` or `plan.units` when it matters.
 */
export function flattenPlanStatements(plan: SerializedPlan): string[] {
  const normalized = normalizePlan(plan);
  return [
    ...normalized.sessionStatements,
    ...normalized.units.flatMap((unit) => unit.statements),
  ];
}

/** Display name for a migration unit, derived from its boundary reason. */
function unitName(reason: ExecutionBoundaryReason): string {
  switch (reason) {
    case "default":
      return "schema_changes";
    case "enum_value_visibility":
      return "after_enum_values";
    case "non_transactional":
      return "non_transactional";
  }
}

function renderUnitSql(
  plan: Plan,
  unit: MigrationUnit,
  index: number,
  options: RenderPlanSqlOptions,
): string {
  const includeTransactions = options.includeTransactions !== false;
  const body =
    options.sqlFormatOptions != null
      ? formatSqlStatements(unit.statements, options.sqlFormatOptions)
      : unit.statements;

  const lines: string[] = [
    `-- Migration unit ${index + 1}: ${unitName(unit.reason)}`,
    `-- Transaction mode: ${unit.transactionMode}`,
    `-- Boundary reason: ${unit.reason}`,
  ];

  if (unit.transactionMode === "none") {
    // PostgreSQL runs every statement of a multi-command simple-query string
    // in an implicit transaction block, so this unit can never execute as
    // part of a single query string — no SET/COMMIT shuffling changes that.
    lines.push(
      "-- Run statement-by-statement (psql does this; do not use psql -1 or",
      "-- send this script as a single multi-statement query string).",
    );
  }

  lines.push("");

  if (plan.sessionStatements.length > 0) {
    lines.push(renderStatements(plan.sessionStatements));
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
