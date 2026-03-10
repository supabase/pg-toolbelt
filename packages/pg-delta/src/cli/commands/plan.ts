/**
 * Plan command - compute schema diff and preview changes.
 */

import { writeFile } from "node:fs/promises";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { Catalog } from "../../core/catalog.model.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { createPlan } from "../../core/plan/index.ts";
import type { SqlFormatOptions } from "../../core/plan/sql-format.ts";
import { ChangesDetected } from "../errors.ts";
import { logInfo } from "../ui.ts";
import { loadIntegrationDSL } from "../utils/integrations.ts";
import { isPostgresUrl, loadCatalogFromFile } from "../utils/resolve-input.ts";
import { formatPlanForDisplay, parseJsonEffect } from "../utils.ts";

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.withDescription(
    "Source (current state): postgres URL or catalog snapshot file path. Omit for empty baseline.",
  ),
  Flag.optional,
);

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription(
    "Target (desired state): postgres URL or catalog snapshot file path",
  ),
);

const format = Flag.choice("format", ["json", "sql"]).pipe(
  Flag.withDescription("Output format override: json (plan) or sql (script)."),
  Flag.optional,
);

const output = Flag.string("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription(
    "Write output to file (stdout by default). If format is not set: .sql infers sql, .json infers json, otherwise uses human output.",
  ),
  Flag.optional,
);

const role = Flag.string("role").pipe(
  Flag.withDescription(
    "Role to use when executing the migration (SET ROLE will be added to statements).",
  ),
  Flag.optional,
);

const filter = Flag.string("filter").pipe(
  Flag.withDescription(
    'Filter DSL as inline JSON to filter changes (e.g., \'{"schema":"public"}\').',
  ),
  Flag.optional,
);

const serialize = Flag.string("serialize").pipe(
  Flag.withDescription(
    'Serialize DSL as inline JSON array (e.g., \'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]\').',
  ),
  Flag.optional,
);

const integration = Flag.string("integration").pipe(
  Flag.withDescription(
    "Integration name (e.g., 'supabase') or path to integration JSON file (must end with .json). Loads from core/integrations/ or file path.",
  ),
  Flag.optional,
);

const sqlFormat = Flag.boolean("sql-format").pipe(
  Flag.withDescription(
    "Format SQL output (opt-in for --format sql or .sql output).",
  ),
  Flag.withDefault(false),
);

const sqlFormatOptions = Flag.string("sql-format-options").pipe(
  Flag.withDescription(
    'SQL format options as inline JSON (e.g., \'{"keywordCase":"upper","maxWidth":100}\').',
  ),
  Flag.optional,
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

      return yield* Effect.fail(
        new ChangesDetected({ message: "Changes detected" }),
      );
    }),
);
