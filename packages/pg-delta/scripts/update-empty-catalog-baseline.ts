/**
 * Update the empty-catalogs baseline by exporting the catalog from a fresh
 * Postgres 15 testcontainer. Run from package root: bun run update-empty-baseline
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractCatalog } from "../src/core/catalog.model.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../src/core/catalog.snapshot.ts";
import { createPool, endPool } from "../src/core/postgres-config.ts";
import { POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG } from "../tests/constants.ts";
import { PostgresAlpineContainer } from "../tests/postgres-alpine.ts";

const PG_VERSION = 15;
const OUTPUT_RELATIVE =
  "src/core/fixtures/empty-catalogs/postgres-15-16-baseline.json";

const pkgRoot = join(import.meta.dir, "..");
const outputPath = join(pkgRoot, OUTPUT_RELATIVE);

const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[PG_VERSION]}`;

console.log("Starting Postgres 15 container...");
const container = await new PostgresAlpineContainer(image).start();

try {
  const uri = container.getConnectionUri();
  const pool = createPool(uri, {
    max: 1,
    onError: (err: Error & { code?: string }) => {
      if (err.code !== "57P01") console.error("Pool error:", err);
    },
  });

  try {
    console.log("Exporting catalog...");
    const catalog = await extractCatalog(pool);
    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);
    await writeFile(outputPath, json, "utf-8");
    console.log(`Done. Baseline written to ${OUTPUT_RELATIVE}`);
  } finally {
    await endPool(pool);
  }
} finally {
  // Don't block on stop(); Docker's graceful shutdown can hang. Give it a short
  // timeout then exit so the process doesn't hang.
  const stopTimeoutMs = 5_000;
  await Promise.race([
    container.stop(),
    new Promise((r) => setTimeout(r, stopTimeoutMs)),
  ]);
  process.exit(0);
}
