/**
 * Barrel re-export for backward compatibility.
 * The catalog module is split into focused files:
 * - catalog.ts: Catalog class and CatalogProps interface
 * - catalog.extract.ts: extractCatalog (Effect-native)
 * - catalog.baseline.ts: createEmptyCatalog and baseline logic
 * - catalog.normalize.ts: normalizeCatalog and related utilities
 */

export { createEmptyCatalog } from "./catalog.baseline.ts";
export { extractCatalog } from "./catalog.extract.ts";

export { Catalog } from "./catalog.ts";
