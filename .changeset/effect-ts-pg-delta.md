---
"@supabase/pg-delta": minor
---

Add Effect-TS support with typed errors, dependency injection, and migrate CLI framework.

- Added tagged error types: `ConnectionError`, `ConnectionTimeoutError`,
  `CatalogExtractionError`, `InvalidPlanError`, `FingerprintMismatchError`,
  `AlreadyAppliedError`, `PlanApplyError`, `DeclarativeApplyError`,
  `StuckError`, `SslConfigError`, `FileDiscoveryError`, `PlanDeserializationError`
- Added `DatabaseService` interface with `makeScopedPool` (scoped pool lifecycle)
  and `wrapPool` (wraps existing Pool)
- Migrated all Zod schemas to Effect Schema (removed `zod` dependency)
- Added Effect-native versions of all catalog extractors (`*Effect` functions)
- Added `extractCatalogEffect` with parallel extraction using `Effect.all`
- Added `createPlanEffect`, `applyPlanEffect`, `applyDeclarativeSchemaEffect`,
  `loadDeclarativeSchemaEffect` pipeline wrappers
- Migrated CLI from `@stricli/core` to `@effect/cli` (removed `@stricli/core` dependency)
- All existing Promise-based APIs remain unchanged for backward compatibility
- New dependencies: `effect`, `@effect/platform`, `@effect/cli`
