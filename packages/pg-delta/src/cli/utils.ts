/**
 * Shared utility functions for CLI commands.
 */

import chalk from "chalk";
import { Effect } from "effect";
import type { Change } from "../core/change.types.ts";
import type { DiffContext } from "../core/context.ts";
import { groupChangesHierarchically } from "../core/plan/hierarchy.ts";
import { type Plan, serializePlan } from "../core/plan/index.ts";
import { classifyChangesRisk } from "../core/plan/risk.ts";
import type { SqlFormatOptions } from "../core/plan/sql-format.ts";
import { formatSqlScript } from "../core/plan/statements.ts";
import { CliExitError } from "./errors.ts";
import { formatTree } from "./formatters/index.ts";
import { confirmAction, logError, logInfo, logWarning } from "./ui.ts";

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
      const previousLevel = chalk.level;
      if (options.disableColors) {
        chalk.level = 0;
      }
      try {
        let treeContent = formatTree(hierarchy);
        if (risk.level === "data_loss") {
          const warningLines = [
            "",
            chalk.yellow("⚠ Data-loss operations detected:"),
            ...risk.statements.map((statement: string) =>
              chalk.yellow(`- ${statement}`),
            ),
          ];
          if (options.showUnsafeFlagSuggestion !== false) {
            warningLines.push(
              chalk.yellow(
                "Use `--unsafe` to allow applying these operations.",
              ),
            );
          }
          const treeLines = treeContent.split("\n");
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
          // Fallback: if legend not found, append at the end
          if (insertIndex === treeLines.length) {
            insertIndex = treeLines.length;
          }
          treeLines.splice(insertIndex, 0, ...warningLines);
          treeContent = treeLines.join("\n");
        }
        // add newline for nicer stdout when in tree mode
        if (!treeContent.endsWith("\n")) {
          treeContent = `${treeContent}\n`;
        }
        return { content: treeContent, label: "Human-readable plan" };
      } finally {
        if (options.disableColors) {
          chalk.level = previousLevel;
        }
      }
    }
  }
}

/**
 * Validates plan risk and handles unsafe operations.
 * Returns validation result with optional exit code.
 */
export function validatePlanRisk(
  plan: Plan,
  unsafe: boolean,
  options?: { suppressWarning?: boolean },
): { valid: boolean; exitCode?: number } {
  if (!unsafe) {
    if (!plan.risk) {
      logError(
        "Plan is missing risk metadata. Regenerate the plan with the current pgdelta or re-run with --unsafe to apply anyway.",
      );
      return { valid: false, exitCode: 1 };
    }
    if (plan.risk.level === "data_loss") {
      if (!options?.suppressWarning) {
        const warningLines = [
          chalk.yellow("⚠ Data-loss operations detected:"),
          ...plan.risk.statements.map((statement: string) =>
            chalk.yellow(`- ${statement}`),
          ),
          chalk.yellow("Use `--unsafe` to allow applying these operations."),
        ];
        logWarning(warningLines.join("\n"));
      }
      return { valid: false, exitCode: 1 };
    }
  }
  return { valid: true };
}

/**
 * Handles applyPlan results and writes appropriate output.
 * Returns the exit code that should be set.
 */
export function handleApplyResult(result: ApplyPlanResult): {
  exitCode: number;
} {
  switch (result.status) {
    case "invalid_plan":
      logError(result.message);
      return { exitCode: 1 };
    case "fingerprint_mismatch":
      logError(
        "Target database does not match plan source fingerprint. Aborting.",
      );
      return { exitCode: 1 };
    case "already_applied":
      logInfo(
        "Plan already applied (target fingerprint matches desired state).",
      );
      return { exitCode: 0 };
    case "failed": {
      logError(
        `Failed to apply changes: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
      );
      logError(`Migration script:\n${result.script}`);
      return { exitCode: 1 };
    }
    case "applied": {
      logInfo(`Applying ${result.statements} changes to database...`);
      logInfo("Successfully applied all changes.");
      if (result.warnings?.length) {
        for (const warning of result.warnings) {
          logWarning(`Warning: ${warning}`);
        }
      }
      return { exitCode: 0 };
    }
  }
}

/**
 * Prompts user for confirmation using clack.
 * Falls back to stdin confirmation in non-interactive mode.
 */
export function promptConfirmation(question: string): Promise<boolean> {
  const promptMessage = question
    .replace(/\(y\/N\)\s*$/i, "")
    .trim()
    .replace(/\?$/, "");
  return confirmAction(promptMessage);
}
