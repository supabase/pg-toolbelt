import { Command, Flag } from "effect/unstable/cli";
import { handleDeclarativeExport } from "./declarative-export.handler.ts";

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

const declarativeExportFlags = {
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
} as const;

export const declarativeExportCommand = Command.make(
  "export",
  declarativeExportFlags,
).pipe(Command.withHandler(handleDeclarativeExport));
