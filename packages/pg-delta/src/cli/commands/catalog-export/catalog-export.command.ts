import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { handleCatalogExport } from "./catalog-export.handler.ts";

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription(
    "Target database connection URL to extract the catalog from",
  ),
);

const output = Flag.string("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("Output file path for the catalog snapshot JSON"),
);

const role = Flag.string("role").pipe(
  Flag.withDescription("Role to use when extracting the catalog (SET ROLE)"),
  Flag.optional,
);

const catalogExportFlags = { target, output, role } as const;

export const catalogExportCommand = Command.make(
  "catalog-export",
  catalogExportFlags,
).pipe(
  Command.withHandler((flags) =>
    handleCatalogExport(flags).pipe(Effect.scoped),
  ),
  Command.withShortDescription("Snapshot a live database catalog to JSON"),
  Command.withDescription(
    "Extracts the full PostgreSQL catalog from a live database and writes it to a JSON snapshot file. That snapshot can later be passed to plan or declarative export as --source or --target for offline diffs without keeping a live connection around.",
  ),
  Command.withExamples([
    {
      command:
        "pgdelta catalog-export --target postgresql://user:pass@localhost:5432/mydb --output snapshot.json",
      description: "Snapshot a database for later offline diffing",
    },
    {
      command:
        "pgdelta catalog-export --target postgresql://user:pass@prod:5432/mydb --output prod-snapshot.json --role readonly_role",
      description:
        "Export through SET ROLE when the snapshot should use a specific role context",
    },
  ]),
);
