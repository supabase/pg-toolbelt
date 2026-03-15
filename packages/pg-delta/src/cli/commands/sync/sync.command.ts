import { Command, Flag } from "effect/unstable/cli";
import { handleSync } from "./sync.handler.ts";

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Source database connection URL (current state)"),
);

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Target database connection URL (desired state)"),
);

const yes = Flag.boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDescription(
    "Skip confirmation prompt and apply changes automatically",
  ),
  Flag.withDefault(false),
);

const unsafe = Flag.boolean("unsafe").pipe(
  Flag.withAlias("u"),
  Flag.withDescription("Allow data-loss operations (unsafe mode)"),
  Flag.withDefault(false),
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

const syncFlags = {
  source,
  target,
  yes,
  unsafe,
  role,
  filter,
  serialize,
  integration,
} as const;

export const syncCommand = Command.make("sync", syncFlags).pipe(
  Command.withHandler(handleSync),
);
