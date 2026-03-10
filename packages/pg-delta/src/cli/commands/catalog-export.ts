/**
 * Catalog export command - extract a database catalog and save as a snapshot JSON file.
 */

import { writeFile } from "node:fs/promises";
import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { extractCatalog } from "../../core/catalog.model.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../core/catalog.snapshot.ts";
import { createManagedPool } from "../../core/postgres-config.ts";
import { logSuccess } from "../ui.ts";

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription(
    "Target database connection URL to extract the catalog from",
  ),
);

const output = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription("Output file path for the catalog snapshot JSON"),
);

const role = Options.text("role").pipe(
  Options.withDescription("Role to use when extracting the catalog (SET ROLE)"),
  Options.optional,
);

export const catalogExportCommand = Command.make(
  "catalog-export",
  { target, output, role },
  (args) =>
    Effect.gen(function* () {
      const roleValue = Option.getOrUndefined(args.role);

      const { pool, close } = yield* Effect.promise(() =>
        createManagedPool(args.target, {
          role: roleValue,
          label: "target",
        }),
      );

      yield* Effect.tryPromise(() =>
        extractCatalog(pool).then(async (catalog) => {
          const snapshot = serializeCatalog(catalog);
          const json = stringifyCatalogSnapshot(snapshot);
          await writeFile(args.output, json, "utf-8");
          logSuccess(`Catalog snapshot written to ${args.output}`);
        }),
      ).pipe(Effect.ensuring(Effect.promise(() => close())));
    }),
);
