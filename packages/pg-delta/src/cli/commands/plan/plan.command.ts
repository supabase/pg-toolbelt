/**
 * Plan command - compute schema diff and preview changes.
 */

import { Command, Flag } from "effect/unstable/cli";
import { handlePlan } from "./plan.handler.ts";

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

const planFlags = {
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
} as const;

export const planCommand = Command.make("plan", planFlags).pipe(
  Command.withHandler(handlePlan),
  Command.withShortDescription("Compute schema diff and preview changes"),
  Command.withDescription(
    `
Compute the schema diff between two PostgreSQL databases (source → target),
and preview it for review or scripting. Defaults to tree display;
json/sql outputs are available for artifacts or piping.
    `.trim(),
  ),
);
