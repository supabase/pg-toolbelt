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
  extractCatalogEffect,
} from "./core/catalog.model.ts";
export type { CatalogSnapshot } from "./core/catalog.snapshot.ts";
export {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "./core/catalog.snapshot.ts";
export {
  loadDeclarativeSchema,
  loadDeclarativeSchemaEffect,
} from "./core/declarative-apply/discover-sql.ts";
export type {
  DeclarativeApplyResult,
  SqlFileEntry,
} from "./core/declarative-apply/index.ts";
// Declarative schema apply
export {
  applyDeclarativeSchema,
  applyDeclarativeSchemaEffect,
} from "./core/declarative-apply/index.ts";
export {
  AlreadyAppliedError,
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  DeclarativeApplyError,
  FileDiscoveryError,
  FingerprintMismatchError,
  InvalidPlanError,
  PlanApplyError,
  PlanDeserializationError,
  SslConfigError,
  StuckError,
} from "./core/errors.ts";
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
export { applyPlan, applyPlanEffect } from "./core/plan/apply.ts";
export type { CatalogInput } from "./core/plan/create.ts";
// Effect-native exports
export { createPlan, createPlanEffect } from "./core/plan/create.ts";
export type { SqlFormatOptions } from "./core/plan/sql-format.ts";
export { formatSqlStatements } from "./core/plan/sql-format.ts";
export type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
export { type DatabaseApi, DatabaseService } from "./core/services/database.ts";
export { makeScopedPool, wrapPool } from "./core/services/database-live.ts";
