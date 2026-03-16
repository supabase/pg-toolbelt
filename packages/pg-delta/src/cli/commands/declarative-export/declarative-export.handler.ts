import { Effect, FileSystem, Option, Path } from "effect";
import { exportDeclarativeSchema } from "../../../core/export/index.ts";
import type { Grouping, GroupingPattern } from "../../../core/export/types.ts";
import { compileSerializeDSL } from "../../../core/integrations/serialize/dsl.ts";
import type { SqlFormatOptions } from "../../../core/plan/sql-format.ts";
import { createPlan } from "../../../effect.ts";
import { CliExitError } from "../../errors.ts";
import { Output } from "../../output/output.service.ts";
import {
  assertSafePath,
  buildFileTree,
  computeFileDiff,
  formatDryRunNotice,
  formatExportSummary,
  formatFileLegend,
} from "../../utils/export-display.ts";
import {
  resolveSourceInput,
  resolveTargetInput,
} from "../../utils/resolve-input.ts";
import { resolveIntegration } from "../../utils/resolve-integration.ts";
import { parseOptionalJson } from "../../utils.ts";

export const handleDeclarativeExport = Effect.fnUntraced(function* (flags: {
  readonly source: Option.Option<string>;
  readonly target: string;
  readonly output: string;
  readonly integration: Option.Option<string>;
  readonly filter: Option.Option<string>;
  readonly serialize: Option.Option<string>;
  readonly groupingMode: Option.Option<"single-file" | "subdirectory">;
  readonly groupPatterns: Option.Option<string>;
  readonly flatSchemas: Option.Option<string>;
  readonly formatOptions: Option.Option<string>;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly diffFocus: boolean;
  readonly verbose: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;
  const path = yield* Path.Path;
  const stdoutUseColors = output.stdoutColorsEnabled;
  const stderrUseColors = output.stderrColorsEnabled;

  const groupPatternsParsed = Option.isSome(flags.groupPatterns)
    ? yield* parseOptionalJson<GroupingPattern[]>(
        "group-patterns",
        flags.groupPatterns,
      ).pipe(
        Effect.flatMap((parsed) =>
          parsed !== undefined && Array.isArray(parsed)
            ? Effect.succeed(parsed)
            : parsed !== undefined
              ? Effect.fail(
                  new CliExitError({
                    exitCode: 1,
                    message: "group-patterns must be a JSON array",
                  }),
                )
              : Effect.succeed(undefined),
        ),
      )
    : undefined;
  const formatOptionsParsed = yield* parseOptionalJson<SqlFormatOptions>(
    "format-options",
    flags.formatOptions,
  );

  const { filter, serialize, emptyCatalog } = yield* resolveIntegration({
    filter: flags.filter,
    serialize: flags.serialize,
    integration: flags.integration,
  });

  const resolvedSource = yield* resolveSourceInput(flags.source, emptyCatalog);
  const resolvedTarget = yield* resolveTargetInput(flags.target);

  const planResult = yield* createPlan(resolvedSource, resolvedTarget, {
    filter,
    serialize,
    skipDefaultPrivilegeSubtraction: true,
  }).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error creating plan: ${error.message}`,
        }),
    ),
  );

  if (!planResult) {
    yield* output.info("No changes detected.");
    return;
  }

  const groupingMode = Option.getOrUndefined(flags.groupingMode);
  const flatSchemas = Option.getOrUndefined(flags.flatSchemas);
  const hasGrouping =
    groupingMode !== undefined ||
    (groupPatternsParsed !== undefined && groupPatternsParsed.length > 0) ||
    (flatSchemas !== undefined && flatSchemas.length > 0);

  let grouping: Grouping | undefined;
  if (hasGrouping) {
    grouping = {
      mode: groupingMode ?? "single-file",
      groupPatterns: groupPatternsParsed,
      autoGroupPartitions: true,
      flatSchemas:
        flatSchemas !== undefined
          ? flatSchemas
              .split(",")
              .map((schemaName) => schemaName.trim())
              .filter(Boolean)
          : undefined,
    };
  }

  const serializeFn =
    serialize !== undefined
      ? Array.isArray(serialize)
        ? compileSerializeDSL(serialize)
        : serialize
      : undefined;

  const exportWarnings: string[] = [];
  const exportOutput = exportDeclarativeSchema(planResult, {
    integration:
      serializeFn !== undefined ? { serialize: serializeFn } : undefined,
    formatOptions: formatOptionsParsed ?? undefined,
    grouping,
    onWarning: (message) => {
      exportWarnings.push(message);
    },
  });

  for (const warning of exportWarnings) {
    yield* output.warn(`Warning: ${warning}`);
  }

  const outputDir = path.resolve(flags.output);
  const applyTip = (dir: string) =>
    `\nTip: To apply this schema to an empty database, run:\n  pgdelta declarative apply --path ${dir} --target <database_url>`;
  const diff = yield* computeFileDiff(outputDir, exportOutput.files);

  const treeOutput = buildFileTree(
    exportOutput.files.map((file) => file.path),
    path.basename(outputDir) || outputDir,
    { diff, diffFocus: flags.diffFocus, useColors: stdoutUseColors },
  );
  yield* output.write(treeOutput);
  yield* output.write(formatFileLegend(stdoutUseColors));

  const summary = formatExportSummary(diff, flags.dryRun, stderrUseColors);
  if (summary) {
    yield* output.info(summary);
  }

  const totalChanges = planResult.sortedChanges.length;
  const totalStatements = exportOutput.files.reduce(
    (sum, file) => sum + file.statements,
    0,
  );
  yield* output.info(
    `Changes: ${totalChanges} | Files: ${exportOutput.files.length} | Statements: ${totalStatements}`,
  );

  if (flags.dryRun) {
    const dryRunDisplay = formatDryRunNotice(
      applyTip(outputDir),
      stderrUseColors,
    );
    yield* output.info(dryRunDisplay.notice);
    yield* output.info(dryRunDisplay.tip);
    return;
  }

  if (flags.force) {
    yield* fs
      .remove(outputDir, { recursive: true })
      .pipe(Effect.orElseSucceed(() => undefined));
    yield* fs.makeDirectory(outputDir, { recursive: true });
  } else if (diff.deleted.length > 0) {
    yield* output.warn(
      `Warning: ${diff.deleted.length} existing file(s) will no longer be present. Use --force to replace the output directory.`,
    );
  }

  for (const file of exportOutput.files) {
    yield* assertSafePath(path, file.path, outputDir).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: error.message,
          }),
      ),
    );
    const filePath = path.join(outputDir, file.path);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error creating export subdirectory: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
    yield* fs.writeFileString(filePath, file.sql).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error writing ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
  }

  yield* output.success(
    `Wrote ${exportOutput.files.length} file(s) to ${outputDir}`,
  );
  yield* output.info(applyTip(outputDir).trim());
});
