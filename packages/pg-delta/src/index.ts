/**
 * @supabase/pg-delta - PostgreSQL migrations made easy
 *
 * This module exports the public API for the pg-delta library.
 */

// Catalog model and extraction
export {
  Catalog,
  createEmptyCatalog,
  extractCatalog,
} from "./core/catalog.model.ts";
export type { CatalogSnapshot } from "./core/catalog.snapshot.ts";
export {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "./core/catalog.snapshot.ts";

// Declarative schema export
export { exportDeclarativeSchema } from "./core/export/index.ts";
export type {
  DeclarativeSchemaOutput,
  FileCategory,
  FileEntry,
  FileMetadata,
} from "./core/export/types.ts";

// Integrations
export type { IntegrationDSL } from "./core/integrations/integration-dsl.ts";

// Plan operations
export { applyPlan } from "./core/plan/apply.ts";
export type { CatalogInput } from "./core/plan/create.ts";
export { createPlan } from "./core/plan/create.ts";
export type { SqlFormatOptions } from "./core/plan/sql-format.ts";
export { formatSqlStatements } from "./core/plan/sql-format.ts";
export type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
