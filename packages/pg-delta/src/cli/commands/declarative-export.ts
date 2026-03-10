/**
 * Declarative export command - export a declarative SQL schema from a database diff.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { Catalog } from "../../core/catalog.model.ts";
import type { CatalogSnapshot } from "../../core/catalog.snapshot.ts";
import { exportDeclarativeSchema } from "../../core/export/index.ts";
import type { Grouping, GroupingPattern } from "../../core/export/types.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { createPlan } from "../../core/plan/index.ts";
import type { SqlFormatOptions } from "../../core/plan/sql-format.ts";
import { CliExitError } from "../errors.ts";
import { logInfo, logSuccess, logWarning } from "../ui.ts";
import {
  assertSafePath,
  buildFileTree,
  computeFileDiff,
  formatExportSummary,
} from "../utils/export-display.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import { isPostgresUrl, loadCatalogFromFile } from "../utils/resolve-input.ts";
import { parseJsonEffect } from "../utils.ts";

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.withDescription(
    "Source (current state): postgres URL or catalog snapshot file path. Omit to export all objects from target.",
  ),
  Flag.optional,
);

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription(
    "Target (desired state): postgres URL or catalog snapshot file path",
  ),
);

const output = Flag.string("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("Output directory path for declarative schema files"),
);

const integration = Flag.string("integration").pipe(
  Flag.withDescription(
    "Integration name (e.g., 'supabase') or path to integration JSON file",
  ),
  Flag.optional,
);

const filter = Flag.string("filter").pipe(
  Flag.withDescription(
    'Filter DSL as inline JSON (e.g., \'{"schema":"public"}\')',
  ),
  Flag.optional,
);

const serialize = Flag.string("serialize").pipe(
  Flag.withDescription(
    'Serialize DSL as inline JSON array (e.g., \'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]\')',
  ),
  Flag.optional,
);

const groupingMode = Flag.choice("grouping-mode", [
  "single-file",
  "subdirectory",
]).pipe(
  Flag.withDescription("How grouped entities are organized on disk"),
  Flag.optional,
);

const groupPatterns = Flag.string("group-patterns").pipe(
  Flag.withDescription(
    'JSON array of {pattern, name} objects (e.g., \'[{"pattern":"^auth","name":"auth"}]\')',
  ),
  Flag.optional,
);

const flatSchemas = Flag.string("flat-schemas").pipe(
  Flag.withDescription(
    "Comma-separated list of schemas to flatten (e.g., partman,pgboss,audit)",
  ),
  Flag.optional,
);

const formatOptions = Flag.string("format-options").pipe(
  Flag.withDescription(
    'SQL format options as inline JSON (e.g., \'{"keywordCase":"lower","maxWidth":180}\')',
  ),
  Flag.optional,
);

const force = Flag.boolean("force").pipe(
  Flag.withDescription("Remove entire output directory before writing"),
  Flag.withDefault(false),
);

const dryRun = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Show tree and summary without writing files"),
  Flag.withDefault(false),
);

const diffFocus = Flag.boolean("diff-focus").pipe(
  Flag.withDescription(
    "Show only files that changed (created/updated/deleted) in the tree",
  ),
  Flag.withDefault(false),
);

const verbose = Flag.boolean("verbose").pipe(
  Flag.withDescription("Show detailed output"),
  Flag.withDefault(false),
);

export const declarativeExportCommand = Command.make(
  "export",
  {
    source,
    target,
    output,
    integration,
    filter,
    serialize,
    groupingMode,
    groupPatterns,
    flatSchemas,
    formatOptions,
    force,
    dryRun,
    diffFocus,
    verbose,
  },
  (args) =>
    Effect.gen(function* () {
      const { compileSerializeDSL } = yield* Effect.promise(
        () => import("../../core/integrations/serialize/dsl.ts"),
      );

      const sourceValue = Option.getOrUndefined(args.source);
      const integrationValue = Option.getOrUndefined(args.integration);
      const filterRaw = Option.getOrUndefined(args.filter);
      const serializeRaw = Option.getOrUndefined(args.serialize);
      const groupingModeValue = Option.getOrUndefined(args.groupingMode);
      const groupPatternsRaw = Option.getOrUndefined(args.groupPatterns);
      const flatSchemasValue = Option.getOrUndefined(args.flatSchemas);
      const formatOptionsRaw = Option.getOrUndefined(args.formatOptions);

      const filterParsed: FilterDSL | undefined = filterRaw
        ? yield* parseJsonEffect<FilterDSL>("filter", filterRaw)
        : undefined;
      const serializeParsed: SerializeDSL | undefined = serializeRaw
        ? yield* parseJsonEffect<SerializeDSL>("serialize", serializeRaw)
        : undefined;
      const groupPatternsParsed: GroupingPattern[] | undefined =
        groupPatternsRaw
          ? yield* parseJsonEffect<GroupingPattern[]>(
              "group-patterns",
              groupPatternsRaw,
            ).pipe(
              Effect.flatMap((parsed) =>
                Array.isArray(parsed)
                  ? Effect.succeed(parsed)
                  : Effect.fail(
                      new CliExitError({
                        exitCode: 1,
                        message: "group-patterns must be a JSON array",
                      }),
                    ),
              ),
            )
          : undefined;
      const formatOptionsParsed: SqlFormatOptions | undefined = formatOptionsRaw
        ? yield* parseJsonEffect<SqlFormatOptions>(
            "format-options",
            formatOptionsRaw,
          )
        : undefined;

      let filterOption: FilterDSL | ChangeFilter | undefined = filterParsed;
      let serializeOption: SerializeDSL | ChangeSerializer | undefined =
        serializeParsed;
      let integrationEmptyCatalog: CatalogSnapshot | undefined;
      if (integrationValue) {
        const integrationDSL = yield* Effect.promise(() =>
          loadIntegrationDSL(integrationValue),
        );
        filterOption = filterOption ?? integrationDSL.filter;
        serializeOption = serializeOption ?? integrationDSL.serialize;
        integrationEmptyCatalog = integrationDSL.emptyCatalog;
      }

      let resolvedSource: string | Catalog | null;
      if (sourceValue) {
        resolvedSource = isPostgresUrl(sourceValue)
          ? sourceValue
          : yield* Effect.promise(() => loadCatalogFromFile(sourceValue));
      } else if (integrationEmptyCatalog) {
        const { deserializeCatalog } = yield* Effect.promise(
          () => import("../../core/catalog.snapshot.ts"),
        );
        resolvedSource = deserializeCatalog(integrationEmptyCatalog);
      } else {
        resolvedSource = null;
      }

      const resolvedTarget = isPostgresUrl(args.target)
        ? args.target
        : yield* Effect.promise(() => loadCatalogFromFile(args.target));

      const planResult = yield* Effect.promise(() =>
        createPlan(resolvedSource, resolvedTarget, {
          filter: filterOption,
          serialize: serializeOption,
          skipDefaultPrivilegeSubtraction: true,
        }),
      );

      if (!planResult) {
        logInfo("No changes detected.");
        return;
      }

      const hasGrouping =
        groupingModeValue !== undefined ||
        (groupPatternsParsed !== undefined && groupPatternsParsed.length > 0) ||
        (flatSchemasValue !== undefined && flatSchemasValue.length > 0);

      let grouping: Grouping | undefined;
      if (hasGrouping) {
        grouping = {
          mode: groupingModeValue ?? "single-file",
          groupPatterns: groupPatternsParsed,
          autoGroupPartitions: true,
          flatSchemas:
            flatSchemasValue !== undefined
              ? flatSchemasValue
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
        };
      }

      const serializeFn =
        serializeOption !== undefined
          ? compileSerializeDSL(serializeOption)
          : undefined;

      const exportOutput = exportDeclarativeSchema(planResult, {
        integration:
          serializeFn !== undefined ? { serialize: serializeFn } : undefined,
        formatOptions: formatOptionsParsed ?? undefined,
        grouping,
        onWarning: (msg) => {
          logWarning(`Warning: ${msg}`);
        },
      });

      const outputDir = path.resolve(args.output);
      const applyTip = (dir: string) =>
        `\nTip: To apply this schema to an empty database, run:\n  pgdelta declarative apply --path ${dir} --target <database_url>`;
      const diff = yield* Effect.promise(() =>
        computeFileDiff(outputDir, exportOutput.files),
      );

      const treeOutput = buildFileTree(
        exportOutput.files.map((f) => f.path),
        path.basename(outputDir) || outputDir,
        { diff, diffFocus: args.diffFocus },
      );
      logInfo(treeOutput);
      logInfo(
        `${chalk.green("+")} created   ${chalk.yellow("~")} updated   ${chalk.red("-")} deleted`,
      );

      const summary = formatExportSummary(diff, args.dryRun);
      if (summary) {
        logInfo(summary);
      }

      const totalChanges = planResult.sortedChanges.length;
      const totalStatements = exportOutput.files.reduce(
        (s, f) => s + f.statements,
        0,
      );
      logInfo(
        `Changes: ${totalChanges} | Files: ${exportOutput.files.length} | Statements: ${totalStatements}`,
      );

      if (args.dryRun) {
        logInfo(chalk.dim("\n(dry-run: no files written)"));
        logInfo(chalk.cyan(applyTip(outputDir)));
        return;
      }

      if (args.force) {
        yield* Effect.promise(() =>
          rm(outputDir, { recursive: true, force: true }),
        );
        yield* Effect.promise(() => mkdir(outputDir, { recursive: true }));
      } else if (diff.deleted.length > 0) {
        logWarning(
          `Warning: ${diff.deleted.length} existing file(s) will no longer be present. Use --force to replace the output directory.`,
        );
      }

      for (const file of exportOutput.files) {
        assertSafePath(file.path, outputDir);
        const filePath = path.join(outputDir, file.path);
        yield* Effect.promise(() =>
          mkdir(path.dirname(filePath), { recursive: true }),
        );
        yield* Effect.promise(() => writeFile(filePath, file.sql));
      }

      logSuccess(`Wrote ${exportOutput.files.length} file(s) to ${outputDir}`);
      logInfo(applyTip(outputDir).trim());
    }),
);
