/**
 * Update the empty-catalogs baseline by exporting the catalog from a fresh
 * Postgres 15 testcontainer.
 *
 * The baseline JSON is used as the "empty database" reference for declarative
 * export and plan commands when comparing against a live DB. This script
 * ensures the baseline matches the exact catalog of a vanilla Postgres 15
 * (Alpine) instance so diffs are stable and reproducible.
 *
 * Usage (from package root):
 *   bun run update-empty-baseline
 *
 * Requirements: Docker running (testcontainers starts a postgres:15.14-alpine
 * container). The script writes to src/core/fixtures/empty-catalogs/
 * postgres-15-16-baseline.json and then exits; container stop is capped so
 * the process does not hang.
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

/** Postgres major version used for the baseline (must match fixture naming). */
const PG_VERSION = 15;

/** Output path relative to package root; shared by declarative/plan code. */
const OUTPUT_RELATIVE =
  "src/core/fixtures/empty-catalogs/postgres-15-16-baseline.json";

const pkgRoot = join(import.meta.dir, "..");
const outputPath = join(pkgRoot, OUTPUT_RELATIVE);

/** Same image as integration tests for consistency. */
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
