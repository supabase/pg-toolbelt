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
export { loadDeclarativeSchema } from "./core/declarative-apply/discover-sql.ts";
export type {
  DeclarativeApplyResult,
  SqlFileEntry,
} from "./core/declarative-apply/index.ts";
export { applyDeclarativeSchema } from "./core/declarative-apply/index.ts";
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
  SslConfigError,
} from "./core/errors.ts";
export { exportDeclarativeSchema } from "./core/export/index.ts";
export type {
  DeclarativeSchemaOutput,
  FileCategory,
  FileEntry,
  FileMetadata,
} from "./core/export/types.ts";
export type { IntegrationDSL } from "./core/integrations/integration-dsl.ts";
export { applyPlan } from "./core/plan/apply.ts";
export type { CatalogInput } from "./core/plan/create.ts";
export { createPlan } from "./core/plan/create.ts";
export type { SqlFormatOptions } from "./core/plan/sql-format.ts";
export { formatSqlStatements } from "./core/plan/sql-format.ts";
export type { CreatePlanOptions, Plan } from "./core/plan/types.ts";
export type {
  DatabaseApi,
  DatabaseConnectionApi,
} from "./core/services/database.ts";
export { DatabaseService } from "./core/services/database.ts";
export { DatabaseResolver } from "./core/services/database-resolver.ts";
