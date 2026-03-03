/**
 * Catalog export command - extract a database catalog and save as a snapshot JSON file.
 */

import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import { extractCatalog } from "../../core/catalog.model.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../core/catalog.snapshot.ts";
import { createManagedPool } from "../../core/postgres-config.ts";

export const catalogExportCommand = buildCommand({
  parameters: {
    flags: {
      target: {
        kind: "parsed",
        brief: "Target database connection URL to extract the catalog from",
        parse: String,
      },
      output: {
        kind: "parsed",
        brief: "Output file path for the catalog snapshot JSON",
        parse: String,
      },
      role: {
        kind: "parsed",
        brief: "Role to use when extracting the catalog (SET ROLE)",
        parse: String,
        optional: true,
      },
    },
    aliases: {
      t: "target",
      o: "output",
    },
  },
  docs: {
    brief: "Export a database catalog as a snapshot JSON file",
    fullDescription: `
Extract the full catalog from a live PostgreSQL database and save it
as a JSON snapshot file. The snapshot can later be used as --source or
--target for the plan and declarative export commands, enabling
offline diffing without a live database connection.

Use cases:
  - Snapshot template1 for use as an empty-database baseline
  - Snapshot a production database to generate revert migrations
  - Snapshot any state for reproducible offline diffs
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      target: string;
      output: string;
      role?: string;
    },
  ) {
    const { pool, close } = await createManagedPool(flags.target, {
      role: flags.role,
      label: "target",
    });

    try {
      const catalog = await extractCatalog(pool);
      const snapshot = serializeCatalog(catalog);
      const json = stringifyCatalogSnapshot(snapshot);
      await writeFile(flags.output, json, "utf-8");
      this.process.stdout.write(
        `Catalog snapshot written to ${flags.output}\n`,
      );
    } finally {
      await close();
    }
  },
});
