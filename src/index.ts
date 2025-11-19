/**
 * pg-diff - PostgreSQL database schema diff tool
 *
 * Compare PostgreSQL databases and generate migration scripts.
 * Supports both regular PostgreSQL connections and PGlite (WASM Postgres).
 */

// Main diff function
export { diff as main, type MainOptions, type DiffContext } from "./main.ts";

// Adapter types for PGlite support
export {
  createPgliteAdapter,
  type DbConnection,
  isPgliteConnection,
} from "./adapter.ts";

// Catalog extraction and diffing
export { extractCatalog, type Catalog } from "./catalog.model.ts";
export { diffCatalogs } from "./catalog.diff.ts";

// Change types
export type { Change } from "./change.types.ts";
