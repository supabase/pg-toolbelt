/**
 * Plan command - compute schema diff and preview changes.
 */

import { writeFile } from "node:fs/promises";
import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { Catalog } from "../../core/catalog.model.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { createPlan } from "../../core/plan/index.ts";
import type { SqlFormatOptions } from "../../core/plan/sql-format.ts";
import { CliExitError } from "../errors.ts";
import { logInfo } from "../ui.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import { isPostgresUrl, loadCatalogFromFile } from "../utils/resolve-input.ts";
import { formatPlanForDisplay, parseJsonEffect } from "../utils.ts";

const source = Options.text("source").pipe(
  Options.withAlias("s"),
  Options.withDescription(
    "Source (current state): postgres URL or catalog snapshot file path. Omit for empty baseline.",
  ),
  Options.optional,
);

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription(
    "Target (desired state): postgres URL or catalog snapshot file path",
  ),
);

const format = Options.choice("format", ["json", "sql"]).pipe(
  Options.withDescription(
    "Output format override: json (plan) or sql (script).",
  ),
  Options.optional,
);

const output = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription(
    "Write output to file (stdout by default). If format is not set: .sql infers sql, .json infers json, otherwise uses human output.",
  ),
  Options.optional,
);

const role = Options.text("role").pipe(
  Options.withDescription(
    "Role to use when executing the migration (SET ROLE will be added to statements).",
  ),
  Options.optional,
);

const filter = Options.text("filter").pipe(
  Options.withDescription(
    'Filter DSL as inline JSON to filter changes (e.g., \'{"schema":"public"}\').',
  ),
  Options.optional,
);

const serialize = Options.text("serialize").pipe(
  Options.withDescription(
    'Serialize DSL as inline JSON array (e.g., \'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]\').',
  ),
  Options.optional,
);

const integration = Options.text("integration").pipe(
  Options.withDescription(
    "Integration name (e.g., 'supabase') or path to integration JSON file (must end with .json). Loads from core/integrations/ or file path.",
  ),
  Options.optional,
);

const sqlFormat = Options.boolean("sql-format").pipe(
  Options.withDescription(
    "Format SQL output (opt-in for --format sql or .sql output).",
  ),
  Options.withDefault(false),
);

const sqlFormatOptions = Options.text("sql-format-options").pipe(
  Options.withDescription(
    'SQL format options as inline JSON (e.g., \'{"keywordCase":"upper","maxWidth":100}\').',
  ),
  Options.optional,
);

export const planCommand = Command.make(
  "plan",
  {
    source,
    target,
    format,
    output,
    role,
    filter,
    serialize,
    integration,
    sqlFormat,
    sqlFormatOptions,
  },
  (args) =>
    Effect.gen(function* () {
      const sourceValue = Option.getOrUndefined(args.source);
      const formatValue = Option.getOrUndefined(args.format);
      const outputValue = Option.getOrUndefined(args.output);
      const roleValue = Option.getOrUndefined(args.role);
      const filterRaw = Option.getOrUndefined(args.filter);
      const serializeRaw = Option.getOrUndefined(args.serialize);
      const integrationValue = Option.getOrUndefined(args.integration);
      const sqlFormatOptionsRaw = Option.getOrUndefined(args.sqlFormatOptions);

      const filterParsed: FilterDSL | undefined = filterRaw
        ? yield* parseJsonEffect<FilterDSL>("filter", filterRaw)
        : undefined;
      const serializeParsed: SerializeDSL | undefined = serializeRaw
        ? yield* parseJsonEffect<SerializeDSL>("serialize", serializeRaw)
        : undefined;
      const sqlFormatOptionsParsed: SqlFormatOptions | undefined =
        sqlFormatOptionsRaw
          ? yield* parseJsonEffect<SqlFormatOptions>(
              "SQL format",
              sqlFormatOptionsRaw,
            )
          : undefined;

      let filterOption: FilterDSL | ChangeFilter | undefined = filterParsed;
      let serializeOption: SerializeDSL | ChangeSerializer | undefined =
        serializeParsed;
      let integrationEmptyCatalog:
        | import("../../core/catalog.snapshot.ts").CatalogSnapshot
        | undefined;
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
          role: roleValue,
          filter: filterOption,
          serialize: serializeOption,
        }),
      );
      if (!planResult) {
        logInfo("No changes detected.");
        return;
      }

      const outputPath = outputValue;
      let effectiveFormat: "tree" | "json" | "sql";
      if (formatValue) {
        effectiveFormat = formatValue;
      } else if (outputPath?.endsWith(".sql")) {
        effectiveFormat = "sql";
      } else if (outputPath?.endsWith(".json")) {
        effectiveFormat = "json";
      } else {
        effectiveFormat = "tree";
      }

      const { content, label } = formatPlanForDisplay(
        planResult,
        effectiveFormat,
        {
          disableColors: !!outputPath,
          showUnsafeFlagSuggestion: false,
          sqlFormatOptions:
            args.sqlFormat || sqlFormatOptionsParsed
              ? (sqlFormatOptionsParsed ?? {})
              : undefined,
        },
      );

      if (outputPath) {
        yield* Effect.promise(() => writeFile(outputPath, content, "utf-8"));
        logInfo(`${label} written to ${outputPath}`);
      } else {
        logInfo(content.endsWith("\n") ? content.trimEnd() : content);
      }

      return yield* Effect.fail(new CliExitError({ exitCode: 2, message: "" }));
    }),
);
