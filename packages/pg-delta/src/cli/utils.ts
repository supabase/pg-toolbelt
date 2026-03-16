/**
 * Shared utility functions for CLI commands.
 */

import { Effect, Option } from "effect";
import { deserializeCatalog } from "../core/catalog.snapshot.ts";
import type { Change } from "../core/change.types.ts";
import type { DiffContext } from "../core/context.ts";
import { groupChangesHierarchically } from "../core/plan/hierarchy.ts";
import { type Plan, serializePlan } from "../core/plan/index.ts";
import { classifyChangesRisk } from "../core/plan/risk.ts";
import type { SqlFormatOptions } from "../core/plan/sql-format.ts";
import { formatSqlScript } from "../core/plan/statements.ts";
import { createAnsiPalette } from "./ansi.ts";
import { CliExitError } from "./errors.ts";
import { formatTree } from "./formatters/index.ts";

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
      let content = formatTree(hierarchy, {
        useColors: !options.disableColors,
      });

      if (risk.level === "data_loss") {
        const warningLines = formatDataLossWarning(risk.statements, {
          showUnsafeFlagSuggestion: options.showUnsafeFlagSuggestion,
          useColors: !options.disableColors,
        });
        const treeLines = content.split("\n");
        let insertIndex = treeLines.length;
        const ansiPattern = new RegExp(
          `${String.fromCharCode(27)}\\[[0-9;]*m`,
          "g",
        );

        for (let i = treeLines.length - 1; i >= 0; i -= 1) {
          const line = treeLines[i];
          const stripped = line.replace(ansiPattern, "").trim();
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

      if (!content.endsWith("\n")) {
        content = `${content}\n`;
      }

      return { content, label: "Human-readable plan" };
    }
  }
}

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

function formatDataLossWarning(
  statements: string[],
  options: { showUnsafeFlagSuggestion?: boolean; useColors?: boolean },
): string[] {
  const palette = createAnsiPalette(options.useColors !== false);
  const lines = [
    "",
    palette.yellow("⚠ Data-loss operations detected:"),
    ...statements.map((statement: string) => palette.yellow(`- ${statement}`)),
  ];
  if (options.showUnsafeFlagSuggestion !== false) {
    lines.push(
      palette.yellow("Use `--unsafe` to allow applying these operations."),
    );
  }
  return lines;
}
