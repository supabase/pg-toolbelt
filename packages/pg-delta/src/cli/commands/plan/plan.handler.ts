import { Effect, FileSystem, Option } from "effect";
import type { SqlFormatOptions } from "../../../core/plan/sql-format.ts";
import { createPlan } from "../../../effect.ts";
import { ChangesDetected, CliExitError } from "../../errors.ts";
import { Output } from "../../output/output.service.ts";
import {
  resolveSourceInput,
  resolveTargetInput,
} from "../../utils/resolve-input.ts";
import { resolveIntegration } from "../../utils/resolve-integration.ts";
import { formatPlanForDisplay, parseOptionalJson } from "../../utils.ts";

export const handlePlan = Effect.fnUntraced(function* (flags: {
  readonly source: Option.Option<string>;
  readonly target: string;
  readonly format: Option.Option<"json" | "sql">;
  readonly output: Option.Option<string>;
  readonly role: Option.Option<string>;
  readonly filter: Option.Option<string>;
  readonly serialize: Option.Option<string>;
  readonly integration: Option.Option<string>;
  readonly sqlFormat: boolean;
  readonly sqlFormatOptions: Option.Option<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;

  const sqlFormatOptionsParsed = yield* parseOptionalJson<SqlFormatOptions>(
    "SQL format",
    flags.sqlFormatOptions,
  );

  const { filter, serialize, emptyCatalog } = yield* resolveIntegration({
    filter: flags.filter,
    serialize: flags.serialize,
    integration: flags.integration,
  });

  const resolvedSource = yield* resolveSourceInput(flags.source, emptyCatalog);
  const resolvedTarget = yield* resolveTargetInput(flags.target);

  const planResult = yield* createPlan(resolvedSource, resolvedTarget, {
    role: Option.getOrUndefined(flags.role),
    filter,
    serialize,
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

  const outputPath = Option.getOrUndefined(flags.output);
  const formatFlag = Option.getOrUndefined(flags.format);

  let effectiveFormat: "tree" | "json" | "sql";
  if (formatFlag) {
    effectiveFormat = formatFlag;
  } else if (outputPath?.endsWith(".sql")) {
    effectiveFormat = "sql";
  } else if (outputPath?.endsWith(".json")) {
    effectiveFormat = "json";
  } else {
    effectiveFormat = "tree";
  }

  const { content, label } = yield* formatPlanForDisplay(
    planResult,
    effectiveFormat,
    {
      disableColors: outputPath !== undefined || !output.stdoutColorsEnabled,
      showUnsafeFlagSuggestion: false,
      sqlFormatOptions:
        flags.sqlFormat || sqlFormatOptionsParsed
          ? (sqlFormatOptionsParsed ?? {})
          : undefined,
    },
  ).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: error.message,
        }),
    ),
  );

  if (outputPath) {
    yield* fs.writeFileString(outputPath, content).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error writing ${label.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`,
          }),
      ),
    );
    yield* output.info(`${label} written to ${outputPath}`);
  } else {
    yield* output.write(content.endsWith("\n") ? content.trimEnd() : content);
  }

  return yield* Effect.fail(
    new ChangesDetected({ message: "Changes detected" }),
  );
});
