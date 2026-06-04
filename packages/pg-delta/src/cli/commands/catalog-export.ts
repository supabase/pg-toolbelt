/**
 * Catalog export command - extract a database catalog and save as a snapshot JSON file.
 */

import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import { filterCatalog } from "../../core/catalog.filter.ts";
import { extractCatalog } from "../../core/catalog.model.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../core/catalog.snapshot.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
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
      filter: {
        kind: "parsed",
        brief:
          'Filter DSL as inline JSON to filter changes (e.g., \'{"*/schema": "app"}\').',
        parse: (value: string): FilterDSL => {
          try {
            return JSON.parse(value) as FilterDSL;
          } catch (error) {
            throw new Error(
              `Invalid filter JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
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

Pass --filter to scope the snapshot to a subset of the catalog (same
Filter DSL accepted by plan/sync). Useful when committing a baseline
snapshot to a repo and only one schema's drift is interesting.
    `.trim(),
  },
  async func(
    this: CommandContext,
    flags: {
      target: string;
      output: string;
      role?: string;
      filter?: FilterDSL;
    },
  ) {
    const { pool, close } = await createManagedPool(flags.target, {
      role: flags.role,
      label: "target",
    });

    try {
      const catalog = await extractCatalog(pool);
      const scoped = flags.filter
        ? await filterCatalog(catalog, flags.filter)
        : catalog;
      const snapshot = serializeCatalog(scoped);
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
