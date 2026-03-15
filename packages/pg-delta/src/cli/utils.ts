/**
 * Shared utility functions for CLI commands.
 */

import chalk from "chalk";
import { Effect, Option } from "effect";
import { deserializeCatalog } from "../core/catalog.snapshot.ts";
import type { Change } from "../core/change.types.ts";
import type { DiffContext } from "../core/context.ts";
import { groupChangesHierarchically } from "../core/plan/hierarchy.ts";
import { type Plan, serializePlan } from "../core/plan/index.ts";
import { classifyChangesRisk } from "../core/plan/risk.ts";
import type { SqlFormatOptions } from "../core/plan/sql-format.ts";
import { formatSqlScript } from "../core/plan/statements.ts";
import { CliExitError } from "./errors.ts";
import { formatTree } from "./formatters/index.ts";
import { Output } from "./output/output.service.ts";

/**
 * Parse a JSON string inside an Effect context. Replaces the throwing
 * `parseJsonSafe` / `parseJsonFlag` helpers that were called from Effect.gen.
 */
export const parseJsonEffect = <T>(
  label: string,
  value: string,
): Effect.Effect<T, CliExitError> =>
  Effect.try({
    try: () => JSON.parse(value) as T,
    catch: (error) =>
      new CliExitError({
        exitCode: 1,
        message: `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

/**
 * Parse an optional JSON string from a CLI flag.
 * Returns the parsed value if the Option is Some, or undefined if None.
 */
export const parseOptionalJson = <T>(
  label: string,
  value: Option.Option<string>,
): Effect.Effect<T | undefined, CliExitError> =>
  Option.isSome(value)
    ? parseJsonEffect<T>(label, value.value)
    : Effect.succeed(undefined as T | undefined);

export const deserializeCatalogSnapshotEffect = (
  snapshot: unknown,
): Effect.Effect<ReturnType<typeof deserializeCatalog>, CliExitError> =>
  Effect.try({
    try: () => deserializeCatalog(snapshot),
    catch: (error) =>
      new CliExitError({
        exitCode: 1,
        message: `Error deserializing catalog: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

// Re-export ApplyPlanResult type for convenience
type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };

type PlanResult = {
  plan: Plan;
  sortedChanges: Change[];
  ctx: DiffContext;
};

interface FormatPlanOptions {
  disableColors?: boolean;
  showUnsafeFlagSuggestion?: boolean;
  sqlFormatOptions?: SqlFormatOptions;
}

/**
 * Formats a plan result for display in various formats.
 */
export function formatPlanForDisplay(
  planResult: PlanResult,
  format: "tree" | "json" | "sql",
  options: FormatPlanOptions = {},
): { content: string; label: string } {
  const { plan, sortedChanges, ctx } = planResult;
  const risk = plan.risk ?? classifyChangesRisk(sortedChanges);
  const planWithRisk = plan.risk ? plan : { ...plan, risk };

  switch (format) {
    case "sql": {
      const content = [
        `-- Risk: ${risk.level === "data_loss" ? `data-loss (${risk.statements.length})` : "safe"}`,
        formatSqlScript(plan.statements, options.sqlFormatOptions),
      ].join("\n");
      return { content, label: "Migration script" };
    }
    case "json": {
      const content = serializePlan(planWithRisk);
      return { content, label: "Plan" };
    }
    default: {
      const hierarchy = groupChangesHierarchically(ctx, sortedChanges);
      const treeContent = withChalkLevel(
        options.disableColors ? 0 : undefined,
        () => {
          let content = formatTree(hierarchy);
          if (risk.level === "data_loss") {
            const warningLines = formatDataLossWarning(risk.statements, {
              showUnsafeFlagSuggestion: options.showUnsafeFlagSuggestion,
              useColors: !options.disableColors,
            });
            const treeLines = content.split("\n");
            // Insert warning after the legend (at the end of the output)
            // Find the legend line which contains "create", "alter", and "drop"
            let insertIndex = treeLines.length;
            const ansiPattern = new RegExp(
              `${String.fromCharCode(27)}\\[[0-9;]*m`,
              "g",
            );
            // Search from the end backwards for the legend
            for (let i = treeLines.length - 1; i >= 0; i--) {
              const line = treeLines[i];
              const stripped = line.replace(ansiPattern, "").trim();
              // Legend format: "+ create   ~ alter   - drop" (or variations)
              if (
                stripped.includes("create") &&
                stripped.includes("alter") &&
                stripped.includes("drop")
              ) {
                insertIndex = i + 1;
                break;
              }
            }
            treeLines.splice(insertIndex, 0, ...warningLines);
            content = treeLines.join("\n");
          }
          // add newline for nicer stdout when in tree mode
          if (!content.endsWith("\n")) {
            content = `${content}\n`;
          }
          return content;
        },
      );
      return { content: treeContent, label: "Human-readable plan" };
    }
  }
}

/**
 * Validate whether a plan may proceed without side effects. Commands own the
 * final user-facing output so they can surface warnings once without the helper
 * also logging and forcing duplicate messages through the CLI boundary.
 */
export function validatePlanRisk(
  plan: Plan,
  unsafe: boolean,
  options?: { suppressWarning?: boolean },
):
  | { valid: true }
  | {
      valid: false;
      exitCode: number;
      message: string;
      warning?: {
        title: string;
        statements: string[];
        suggestion: string;
      };
    } {
  if (!unsafe) {
    if (!plan.risk) {
      return {
        valid: false,
        exitCode: 1,
        message:
          "Plan is missing risk metadata. Regenerate the plan with the current pgdelta or re-run with --unsafe to apply anyway.",
      };
    }
    const risk = plan.risk;
    if (risk.level === "data_loss") {
      return {
        valid: false,
        exitCode: 1,
        message:
          "Data-loss operations detected. Re-run with --unsafe to allow applying this plan.",
        warning: options?.suppressWarning
          ? undefined
          : {
              title: "Data-loss operations detected:",
              statements: risk.statements,
              suggestion: "Use `--unsafe` to allow applying these operations.",
            },
      };
    }
  }
  return { valid: true };
}

/**
 * Handles applyPlan results and writes appropriate output.
 * Returns the exit code that should be set.
 */
export const handleApplyResultEffect = (
  result: ApplyPlanResult,
): Effect.Effect<{ exitCode: number }, never, Output> =>
  Effect.gen(function* () {
    const output = yield* Output;

    switch (result.status) {
      case "invalid_plan":
        yield* output.error(result.message);
        return { exitCode: 1 };
      case "fingerprint_mismatch":
        yield* output.error(
          "Target database does not match plan source fingerprint. Aborting.",
        );
        return { exitCode: 1 };
      case "already_applied":
        yield* output.info(
          "Plan already applied (target fingerprint matches desired state).",
        );
        return { exitCode: 0 };
      case "failed": {
        yield* output.error(
          `Failed to apply changes: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
        );
        yield* output.error(`Migration script:\n${result.script}`);
        return { exitCode: 1 };
      }
      case "applied": {
        yield* output.info(
          `Applying ${result.statements} changes to database...`,
        );
        yield* output.info("Successfully applied all changes.");
        if (result.warnings?.length) {
          for (const warning of result.warnings) {
            yield* output.warn(`Warning: ${warning}`);
          }
        }
        return { exitCode: 0 };
      }
    }
  });

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Temporarily override chalk.level for the duration of `fn`.
 * If `level` is undefined, runs `fn` without any override.
 */
function withChalkLevel<T>(level: number | undefined, fn: () => T): T {
  if (level === undefined) return fn();
  const prev = chalk.level;
  chalk.level = level as typeof chalk.level;
  try {
    return fn();
  } finally {
    chalk.level = prev;
  }
}

/**
 * Format data-loss warning lines with optional coloring.
 */
export function formatDataLossWarning(
  statements: string[],
  options: { showUnsafeFlagSuggestion?: boolean; useColors?: boolean },
): string[] {
  const yellow = options.useColors !== false ? chalk.yellow : (s: string) => s;
  const lines = [
    "",
    yellow("⚠ Data-loss operations detected:"),
    ...statements.map((statement: string) => yellow(`- ${statement}`)),
  ];
  if (options.showUnsafeFlagSuggestion !== false) {
    lines.push(yellow("Use `--unsafe` to allow applying these operations."));
  }
  return lines;
}
