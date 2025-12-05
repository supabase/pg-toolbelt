/**
 * Plan command - compute schema diff and preview changes.
 */

import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import chalk from "chalk";
import postgres from "postgres";
import { diffCatalogs } from "../../core/catalog.diff.ts";
import { extractCatalog } from "../../core/catalog.model.ts";
import type { DiffContext } from "../../core/context.ts";
import { base } from "../../core/integrations/base.ts";
import type { Plan, PlanStats } from "../../core/plan/index.ts";
import {
  buildPlanScopeFingerprint,
  groupChangesHierarchically,
  hashStableIds,
  serializePlan,
  sha256,
} from "../../core/plan/index.ts";
import { postgresConfig } from "../../core/postgres-config.ts";
import { sortChanges } from "../../core/sort/sort-changes.ts";
import { formatTree } from "../formatters/index.ts";

export const planCommand = buildCommand({
  parameters: {
    flags: {
      source: {
        kind: "parsed",
        brief: "Source database connection URL (current state)",
        parse: String,
      },
      target: {
        kind: "parsed",
        brief: "Target database connection URL (desired state)",
        parse: String,
      },
      format: {
        kind: "enum",
        brief: "Output format override: json (plan) or sql (script).",
        values: ["json", "sql"] as const,
        optional: true,
      },
      output: {
        kind: "parsed",
        brief:
          "Write output to file (stdout by default). If format is not set: .sql infers sql, .json infers json, otherwise uses human output.",
        parse: String,
        optional: true,
      },
    },
    aliases: {
      s: "source",
      t: "target",
      o: "output",
    },
  },
  docs: {
    brief: "Compute schema diff and preview changes",
    fullDescription: `
Compute the schema diff between two PostgreSQL databases (source → target),
and preview it for review or scripting. Defaults to tree display;
json/sql outputs are available for artifacts or piping.
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      source: string;
      target: string;
      format?: "json" | "sql";
      output?: string;
    },
  ) {
    const fromSql = postgres(flags.source, postgresConfig);
    const toSql = postgres(flags.target, postgresConfig);

    try {
      // Extract catalogs
      const [fromCatalog, toCatalog] = await Promise.all([
        extractCatalog(fromSql),
        extractCatalog(toSql),
      ]);

      // Compute diff
      const changes = diffCatalogs(fromCatalog, toCatalog);

      const integration = base;
      const ctx: DiffContext = {
        mainCatalog: fromCatalog,
        branchCatalog: toCatalog,
      };

      // Apply filter
      const integrationFilter = integration.filter;
      const filteredChanges = integrationFilter
        ? changes.filter((change) => integrationFilter(ctx, change))
        : changes;

      if (filteredChanges.length === 0) {
        this.process.stdout.write("No changes detected.\n");
        return;
      }

      // Sort changes
      const sortedChanges = sortChanges(ctx, filteredChanges);

      // Generate SQL script
      const hasRoutineChanges = sortedChanges.some(
        (change) =>
          change.objectType === "procedure" ||
          change.objectType === "aggregate",
      );
      const sqlParts: string[] = [];
      if (hasRoutineChanges) {
        sqlParts.push("SET check_function_bodies = false");
      }
      for (const change of sortedChanges) {
        const sql = integration.serialize?.(ctx, change) ?? change.serialize();
        sqlParts.push(sql);
      }
      const sql = `${sqlParts.join(";\n\n")};`;

      // Compute stats
      const stats: PlanStats = {
        total: sortedChanges.length,
        creates: 0,
        alters: 0,
        drops: 0,
        byObjectType: {},
      };
      for (const change of sortedChanges) {
        switch (change.operation) {
          case "create":
            stats.creates++;
            break;
          case "alter":
            stats.alters++;
            break;
          case "drop":
            stats.drops++;
            break;
        }
        stats.byObjectType[change.objectType] =
          (stats.byObjectType[change.objectType] ?? 0) + 1;
      }

      const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
        fromCatalog,
        sortedChanges,
      );
      const fingerprintTo = hashStableIds(toCatalog, stableIds);
      const sqlHash = sha256(sql);

      const plan: Plan = {
        version: 1,
        integration: { id: "base" },
        source: { url: flags.source },
        target: { url: flags.target },
        stableIds,
        fingerprintFrom,
        fingerprintTo,
        sqlHash,
        sql,
        stats,
      };

      const outputPath = flags.output;
      let effectiveFormat: "tree" | "json" | "sql";
      if (flags.format) {
        effectiveFormat = flags.format;
      } else if (outputPath?.endsWith(".sql")) {
        effectiveFormat = "sql";
      } else if (outputPath?.endsWith(".json")) {
        effectiveFormat = "json";
      } else {
        effectiveFormat = "tree";
      }

      let content: string;
      let writtenLabel: string;
      switch (effectiveFormat) {
        case "sql":
          content = plan.sql;
          writtenLabel = "Migration script";
          break;
        case "json":
          content = serializePlan(plan);
          writtenLabel = "Plan";
          break;
        default: {
          const hierarchy = groupChangesHierarchically(ctx, sortedChanges);
          const previousLevel = chalk.level;
          if (outputPath) {
            chalk.level = 0; // disable colors when writing to file
          }
          try {
            content = formatTree(hierarchy, plan.stats);
          } finally {
            if (outputPath) {
              chalk.level = previousLevel;
            }
          }
          // add newline for nicer stdout when in tree mode
          if (!outputPath && !content.endsWith("\n")) {
            content = `${content}\n`;
          }
          writtenLabel = "Human-readable plan";
          break;
        }
      }

      if (outputPath) {
        await writeFile(outputPath, content, "utf-8");
        this.process.stdout.write(`${writtenLabel} written to ${outputPath}\n`);
      } else {
        this.process.stdout.write(content);
        if (!content.endsWith("\n")) {
          this.process.stdout.write("\n");
        }
      }

      // Exit code 2 indicates changes were detected
      process.exitCode = 2;
    } finally {
      await Promise.all([fromSql.end(), toSql.end()]);
    }
  },
});
