/**
 * Catalog export – programmatic API for extracting a database catalog
 * and serializing it to a JSON snapshot.
 *
 * Use this subpath when you only need catalog export (e.g. Supabase CLI
 * edge-runtime templates) without pulling in the full pg-delta API.
 */

export {
  Catalog,
  createEmptyCatalog,
  extractCatalog,
} from "../catalog.model.ts";
export type { CatalogSnapshot } from "../catalog.snapshot.ts";
export {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../catalog.snapshot.ts";
export { createManagedPool } from "../postgres-config.ts";
