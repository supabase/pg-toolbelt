/**
 * Declarative export command - export a declarative SQL schema from a database diff.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCommand, type CommandContext } from "@stricli/core";
import chalk from "chalk";
import { exportDeclarativeSchema } from "../../core/export/index.ts";
import type { Grouping, GroupingPattern } from "../../core/export/types.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { createPlan } from "../../core/plan/index.ts";
import type { SqlFormatOptions } from "../../core/plan/sql-format.ts";
import {
  buildFileTree,
  computeFileDiff,
  formatExportSummary,
} from "../utils/export-display.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";

function parseFilterDSL(value: string): FilterDSL {
  try {
    return JSON.parse(value) as FilterDSL;
  } catch (error) {
    throw new Error(
      `Invalid filter JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseSerializeDSL(value: string): SerializeDSL {
  try {
    return JSON.parse(value) as SerializeDSL;
  } catch (error) {
    throw new Error(
      `Invalid serialize JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseGroupPatterns(value: string): GroupingPattern[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error("group-patterns must be a JSON array");
    }
    return parsed as GroupingPattern[];
  } catch (error) {
    throw new Error(
      `Invalid group-patterns JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseFormatOptions(value: string): SqlFormatOptions {
  try {
    return JSON.parse(value) as SqlFormatOptions;
  } catch (error) {
    throw new Error(
      `Invalid format-options JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const declarativeExportCommand = buildCommand({
  parameters: {
    flags: {
      source: {
        kind: "parsed",
        brief: "Source database connection URL (current state)",
        parse: String,
      },
      target: {
        kind: "parsed",
        brief: "Target database connection URL (desired state / empty db)",
        parse: String,
      },
      output: {
        kind: "parsed",
        brief: "Output directory path for declarative schema files",
        parse: String,
      },
      integration: {
        kind: "parsed",
        brief:
          "Integration name (e.g., 'supabase') or path to integration JSON file",
        parse: String,
        optional: true,
      },
      filter: {
        kind: "parsed",
        brief: 'Filter DSL as inline JSON (e.g., \'{"schema":"public"}\')',
        parse: parseFilterDSL,
        optional: true,
      },
      serialize: {
        kind: "parsed",
        brief:
          'Serialize DSL as inline JSON array (e.g., \'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]\')',
        parse: parseSerializeDSL,
        optional: true,
      },
      "grouping-mode": {
        kind: "enum",
        brief: "How grouped entities are organized on disk",
        values: ["single-file", "subdirectory"] as const,
        optional: true,
      },
      "group-patterns": {
        kind: "parsed",
        brief:
          'JSON array of {pattern, name} objects (e.g., \'[{"pattern":"^auth","name":"auth"}]\')',
        parse: parseGroupPatterns,
        optional: true,
      },
      "flat-schemas": {
        kind: "parsed",
        brief:
          "Comma-separated list of schemas to flatten (e.g., partman,pgboss,audit)",
        parse: String,
        optional: true,
      },
      "format-options": {
        kind: "parsed",
        brief:
          'SQL format options as inline JSON (e.g., \'{"keywordCase":"lower","maxWidth":180}\')',
        parse: parseFormatOptions,
        optional: true,
      },
      force: {
        kind: "boolean",
        brief: "Remove entire output directory before writing",
        optional: true,
      },
      "dry-run": {
        kind: "boolean",
        brief: "Show tree and summary without writing files",
        optional: true,
      },
      "diff-focus": {
        kind: "boolean",
        brief:
          "Show only files that changed (created/updated/deleted) in the tree",
        optional: true,
      },
      verbose: {
        kind: "boolean",
        brief: "Show detailed output",
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
    brief: "Export a declarative schema from a database diff",
    fullDescription: `
Export a declarative SQL schema by comparing two databases (source → target).
Writes .sql files to the output directory, grouped by object type and optional
grouping rules.

Flags:
  source, target  - Database connection URLs (source = current, target = desired)
  output         - Directory path for generated .sql files
  integration    - Integration name or path (e.g., supabase) for filter/serialize
  filter         - Filter DSL as JSON to include/exclude changes
  serialize      - Serialize DSL as JSON array for custom SQL generation
  grouping-mode  - single-file or subdirectory for grouped entities
  group-patterns - JSON array of {pattern, name} for name-based grouping
  flat-schemas   - Comma-separated schemas to merge into one file per category
  format-options - SQL format options as JSON
  force          - Remove output directory before writing (full replace)
  dry-run        - Show tree and summary only, do not write files
  diff-focus     - Show only changed files (created/updated/deleted) in the tree
  verbose        - Show detailed output

After export, a tip is printed with the command to apply the schema to an empty database.
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      source: string;
      target: string;
      output: string;
      integration?: string;
      filter?: FilterDSL;
      serialize?: SerializeDSL;
      "grouping-mode"?: "single-file" | "subdirectory";
      "group-patterns"?: GroupingPattern[];
      "flat-schemas"?: string;
      "format-options"?: SqlFormatOptions;
      force?: boolean;
      "dry-run"?: boolean;
      "diff-focus"?: boolean;
      verbose?: boolean;
    },
  ) {
    const { compileFilterDSL } = await import(
      "../../core/integrations/filter/dsl.ts"
    );
    const { compileSerializeDSL } = await import(
      "../../core/integrations/serialize/dsl.ts"
    );

    let filterOption: FilterDSL | ChangeFilter | undefined = flags.filter;
    let serializeOption: SerializeDSL | ChangeSerializer | undefined =
      flags.serialize;
    if (flags.integration) {
      const integrationDSL = await loadIntegrationDSL(flags.integration);
      filterOption = filterOption ?? integrationDSL.filter;
      serializeOption = serializeOption ?? integrationDSL.serialize;
    }

    const filterFn =
      filterOption !== undefined ? compileFilterDSL(filterOption) : undefined;
    const serializeFn =
      serializeOption !== undefined
        ? compileSerializeDSL(serializeOption)
        : undefined;

    const planResult = await createPlan(flags.source, flags.target, {
      filter: filterFn,
      serialize: serializeFn,
    });

    if (!planResult) {
      this.process.stdout.write("No changes detected.\n");
      return;
    }

    const hasGrouping =
      flags["grouping-mode"] !== undefined ||
      (flags["group-patterns"] !== undefined &&
        flags["group-patterns"].length > 0) ||
      (flags["flat-schemas"] !== undefined && flags["flat-schemas"].length > 0);

    let grouping: Grouping | undefined;
    if (hasGrouping) {
      grouping = {
        mode: flags["grouping-mode"] ?? "single-file",
        groupPatterns: flags["group-patterns"],
        autoGroupPartitions: true,
        flatSchemas:
          flags["flat-schemas"] !== undefined
            ? flags["flat-schemas"]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
      };
    }

    const output = exportDeclarativeSchema(planResult, {
      integration:
        serializeFn !== undefined ? { serialize: serializeFn } : undefined,
      formatOptions: flags["format-options"] ?? undefined,
      grouping,
    });

    const outputDir = path.resolve(flags.output);
    const diff = await computeFileDiff(outputDir, output.files);

    this.process.stdout.write("\n");
    this.process.stdout.write(
      `${buildFileTree(
        output.files.map((f) => f.path),
        path.basename(outputDir) || outputDir,
        { diff, diffFocus: !!flags["diff-focus"] },
      )}\n`,
    );
    this.process.stdout.write("\n");
    this.process.stdout.write(
      `${chalk.green("+")} created   ${chalk.yellow("~")} updated   ${chalk.red("-")} deleted\n`,
    );
    this.process.stdout.write("\n");

    const summary = formatExportSummary(diff, !!flags["dry-run"]);
    if (summary) {
      this.process.stdout.write(`${summary}\n`);
    }

    const totalChanges = planResult.sortedChanges.length;
    const totalStatements = output.files.reduce((s, f) => s + f.statements, 0);
    this.process.stdout.write(
      `Changes: ${totalChanges} | Files: ${output.files.length} | Statements: ${totalStatements}\n`,
    );

    if (flags["dry-run"]) {
      this.process.stdout.write(chalk.dim("\n(dry-run: no files written)\n"));
      this.process.stdout.write(
        chalk.cyan(
          `\nTip: To apply this schema to an empty database, run:\n  pgdelta declarative apply --path ${outputDir} --target <database_url>\n`,
        ),
      );
      return;
    }

    if (flags.force) {
      await rm(outputDir, { recursive: true, force: true });
      await mkdir(outputDir, { recursive: true });
    } else if (diff.deleted.length > 0) {
      this.process.stderr.write(
        chalk.yellow(
          `Warning: ${diff.deleted.length} existing file(s) will no longer be present. Use --force to replace the output directory.\n`,
        ),
      );
    }

    for (const file of output.files) {
      const filePath = path.join(outputDir, file.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.sql);
    }

    this.process.stdout.write(
      chalk.green(`Wrote ${output.files.length} file(s) to ${outputDir}\n`),
    );
    this.process.stdout.write(
      chalk.cyan(
        `\nTip: To apply this schema to an empty database, run:\n  pgdelta declarative apply --path ${outputDir} --target <database_url>\n`,
      ),
    );
  },
});
