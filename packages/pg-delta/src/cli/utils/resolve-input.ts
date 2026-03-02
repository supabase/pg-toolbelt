/**
 * Shared utilities for resolving CLI --source/--target inputs that
 * can be either a PostgreSQL connection URL or a catalog snapshot file path.
 */

import { readFile } from "node:fs/promises";
import type { Catalog } from "../../core/catalog.model.ts";
import { deserializeCatalog } from "../../core/catalog.snapshot.ts";

export function isPostgresUrl(input: string): boolean {
  return input.startsWith("postgres://") || input.startsWith("postgresql://");
}

export async function loadCatalogFromFile(path: string): Promise<Catalog> {
  const json = await readFile(path, "utf-8");
  return deserializeCatalog(JSON.parse(json));
}
