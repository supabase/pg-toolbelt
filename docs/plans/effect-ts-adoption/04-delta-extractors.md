---
name: "Effect-TS Phase 3a-3b: pg-delta Extractors and Catalog"
overview: Convert all 28 catalog extractors from async Pool functions to Effect functions using DatabaseApi, then convert extractCatalog to use Effect.all for parallel extraction.
todos:
  - id: phase-3a-pattern
    content: Define the extractor conversion pattern
    status: pending
  - id: phase-3a-context
    content: Convert context.ts (extractVersion, extractCurrentUser)
    status: pending
  - id: phase-3a-depend
    content: Convert depend.ts (extractDepends)
    status: pending
  - id: phase-3a-models
    content: Convert all 25 object model extractors
    status: pending
  - id: phase-3b-catalog
    content: Convert extractCatalog and createEmptyCatalog in catalog.model.ts
    status: pending
  - id: verify
    content: Run check-types + unit tests
    status: pending
isProject: false
---

# Phase 3a-3b: pg-delta Extractors and Catalog — Detailed Implementation

## Prerequisites

- Phase 2a-2c complete (errors.ts, DatabaseService, Effect Schema all in place)

---

## Phase 3a: Convert All Catalog Extractors

### The Pattern

Every extractor follows the same conversion pattern. Here's the before/after:

**Before (current pattern — every extractor):**

```typescript
import { sql } from "@ts-safeql/sql-tag";
import type { Pool } from "pg";

export async function extractTables(pool: Pool): Promise<Table[]> {
  const { rows } = await pool.query(sql`SELECT ... FROM ...`);
  return rows.map((row) => new Table(row));
}
```

**After (Effect pattern):**

```typescript
import { sql } from "@ts-safeql/sql-tag";
import { Effect } from "effect";
import type { DatabaseApi } from "../services/database.ts";
import type { CatalogExtractionError } from "../errors.ts";

export const extractTablesEffect = (
  db: DatabaseApi,
): Effect.Effect<Table[], CatalogExtractionError> =>
  Effect.gen(function* () {
    const { rows } = yield* db.query<TableRow>(sql`SELECT ... FROM ...`);
    return rows.map((row) => new Table(row));
  });

// Keep backward-compat wrapper
export async function extractTables(pool: Pool): Promise<Table[]> {
  const { rows } = await pool.query(sql`SELECT ... FROM ...`);
  return rows.map((row) => new Table(row));
}
```

**Key points:**

- The SQL queries stay IDENTICAL — no changes to query text
- The model classes (Table, View, etc.) and their constructors stay IDENTICAL
- The `@ts-safeql/sql-tag` usage stays IDENTICAL
- Only the async/await wrapper changes to Effect.gen + yield
- Each extractor gets a `*Effect` suffix variant
- The old function is kept for backward compatibility during migration

### Conversion Approach: Mechanical Transform

Since the pattern is identical for all 28 extractors, this is a mechanical transformation. For each file:

1. Add imports: `import { Effect } from "effect"; import type { DatabaseApi } from "../services/database.ts"; import type { CatalogExtractionError } from "../errors.ts";`
2. Add new function: Copy the existing function, rename with `Effect` suffix, replace `async function` with `Effect.gen`, replace `await pool.query(...)` with `yield* db.query<RowType>(...)`
3. Keep old function as-is

### Files to Convert (28 total)

#### Context extractors (2 files)

`**src/core/context.ts` — `extractVersion(pool)` and `extractCurrentUser(pool)`

```typescript
// Current:
export async function extractVersion(pool: Pool): Promise<number> {
  const { rows } = await pool.query("SHOW server_version_num");
  return Number.parseInt(rows[0].server_version_num, 10);
}

export async function extractCurrentUser(pool: Pool): Promise<string> {
  const { rows } = await pool.query("SELECT current_user");
  return rows[0].current_user;
}

// Add:
export const extractVersionEffect = (
  db: DatabaseApi,
): Effect.Effect<number, CatalogExtractionError> =>
  Effect.gen(function* () {
    const { rows } = yield* db.query<{ server_version_num: string }>(
      "SHOW server_version_num",
    );
    return Number.parseInt(rows[0].server_version_num, 10);
  });

export const extractCurrentUserEffect = (
  db: DatabaseApi,
): Effect.Effect<string, CatalogExtractionError> =>
  Effect.gen(function* () {
    const { rows } = yield* db.query<{ current_user: string }>(
      "SELECT current_user",
    );
    return rows[0].current_user;
  });
```

`**src/core/depend.ts**` — `extractDepends(pool)`

Same pattern — the SQL query returns `PgDepend[]`. Add `extractDependsEffect` alongside.

#### Object model extractors (25 files)

Each file under `src/core/objects/*/` has an `extract*` function. Full list:

| #   | File                                                                      | Function                       | Returns                |
| --- | ------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| 1   | `aggregate/aggregate.model.ts`                                            | `extractAggregates`            | `Aggregate[]`          |
| 2   | `collation/collation.model.ts`                                            | `extractCollations`            | `Collation[]`          |
| 3   | `domain/domain.model.ts`                                                  | `extractDomains`               | `Domain[]`             |
| 4   | `event-trigger/event-trigger.model.ts`                                    | `extractEventTriggers`         | `EventTrigger[]`       |
| 5   | `extension/extension.model.ts`                                            | `extractExtensions`            | `Extension[]`          |
| 6   | `foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts` | `extractForeignDataWrappers`   | `ForeignDataWrapper[]` |
| 7   | `foreign-data-wrapper/foreign-table/foreign-table.model.ts`               | `extractForeignTables`         | `ForeignTable[]`       |
| 8   | `foreign-data-wrapper/server/server.model.ts`                             | `extractServers`               | `Server[]`             |
| 9   | `foreign-data-wrapper/user-mapping/user-mapping.model.ts`                 | `extractUserMappings`          | `UserMapping[]`        |
| 10  | `index/index.model.ts`                                                    | `extractIndexes`               | `Index[]`              |
| 11  | `language/language.model.ts`                                              | `extractLanguages` (if exists) | -                      |
| 12  | `materialized-view/materialized-view.model.ts`                            | `extractMaterializedViews`     | `MaterializedView[]`   |
| 13  | `procedure/procedure.model.ts`                                            | `extractProcedures`            | `Procedure[]`          |
| 14  | `publication/publication.model.ts`                                        | `extractPublications`          | `Publication[]`        |
| 15  | `rls-policy/rls-policy.model.ts`                                          | `extractRlsPolicies`           | `RlsPolicy[]`          |
| 16  | `role/role.model.ts`                                                      | `extractRoles`                 | `Role[]`               |
| 17  | `rule/rule.model.ts`                                                      | `extractRules`                 | `Rule[]`               |
| 18  | `schema/schema.model.ts`                                                  | `extractSchemas`               | `Schema[]`             |
| 19  | `sequence/sequence.model.ts`                                              | `extractSequences`             | `Sequence[]`           |
| 20  | `subscription/subscription.model.ts`                                      | `extractSubscriptions`         | `Subscription[]`       |
| 21  | `table/table.model.ts`                                                    | `extractTables`                | `Table[]`              |
| 22  | `trigger/trigger.model.ts`                                                | `extractTriggers`              | `Trigger[]`            |
| 23  | `type/composite-type/composite-type.model.ts`                             | `extractCompositeTypes`        | `CompositeType[]`      |
| 24  | `type/enum/enum.model.ts`                                                 | `extractEnums`                 | `Enum[]`               |
| 25  | `type/range/range.model.ts`                                               | `extractRanges`                | `Range[]`              |
| 26  | `view/view.model.ts`                                                      | `extractViews`                 | `View[]`               |

**Note:** Some extractors have more complex patterns (multiple queries, joins, sub-queries). The conversion is still mechanical — each `await pool.query(...)` becomes `yield* db.query<RowType>(...)`.

### What does NOT change

- All `*.diff.ts` files (25 files) — pure sync, no database access
- All `changes/*.ts` files — pure sync serialization
- `base.model.ts`, `base.diff.ts`, `base.change.ts`, `base.privilege-diff.ts` — pure sync
- `src/core/objects/utils.ts` — pure sync
- `src/core/objects/diff-context.ts` — pure type

---

## Phase 3b: Convert extractCatalog and createEmptyCatalog

### Modify: `packages/pg-delta/src/core/catalog.model.ts`

**Current state (lines 305-404):** `extractCatalog(pool: Pool)` uses `Promise.all` to run 28 extractors in parallel.

**Add `extractCatalogEffect`:**

```typescript
import { Effect } from "effect";
import type { DatabaseApi } from "./services/database.ts";
import type { CatalogExtractionError } from "./errors.ts";

export const extractCatalogEffect = (
  db: DatabaseApi,
): Effect.Effect<Catalog, CatalogExtractionError> =>
  Effect.gen(function* () {
    // Run all extractors in parallel (same as current Promise.all)
    const results = yield* Effect.all(
      {
        aggregates: extractAggregatesEffect(db).pipe(Effect.map(listToRecord)),
        collations: extractCollationsEffect(db).pipe(Effect.map(listToRecord)),
        compositeTypes: extractCompositeTypesEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        domains: extractDomainsEffect(db).pipe(Effect.map(listToRecord)),
        enums: extractEnumsEffect(db).pipe(Effect.map(listToRecord)),
        extensions: extractExtensionsEffect(db).pipe(Effect.map(listToRecord)),
        indexes: extractIndexesEffect(db).pipe(Effect.map(listToRecord)),
        materializedViews: extractMaterializedViewsEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        subscriptions: extractSubscriptionsEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        publications: extractPublicationsEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        procedures: extractProceduresEffect(db).pipe(Effect.map(listToRecord)),
        rlsPolicies: extractRlsPoliciesEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        roles: extractRolesEffect(db).pipe(Effect.map(listToRecord)),
        schemas: extractSchemasEffect(db).pipe(Effect.map(listToRecord)),
        sequences: extractSequencesEffect(db).pipe(Effect.map(listToRecord)),
        tables: extractTablesEffect(db).pipe(Effect.map(listToRecord)),
        triggers: extractTriggersEffect(db).pipe(Effect.map(listToRecord)),
        eventTriggers: extractEventTriggersEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        rules: extractRulesEffect(db).pipe(Effect.map(listToRecord)),
        ranges: extractRangesEffect(db).pipe(Effect.map(listToRecord)),
        views: extractViewsEffect(db).pipe(Effect.map(listToRecord)),
        foreignDataWrappers: extractForeignDataWrappersEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        servers: extractServersEffect(db).pipe(Effect.map(listToRecord)),
        userMappings: extractUserMappingsEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        foreignTables: extractForeignTablesEffect(db).pipe(
          Effect.map(listToRecord),
        ),
        depends: extractDependsEffect(db),
        version: extractVersionEffect(db),
        currentUser: extractCurrentUserEffect(db),
      },
      { concurrency: "unbounded" },
    );

    const indexableObjects = {
      ...results.tables,
      ...results.materializedViews,
    };

    const catalog = new Catalog({ ...results, indexableObjects });
    return normalizeCatalog(catalog);
  });
```

**Key:** `Effect.all({ ... }, { concurrency: "unbounded" })` is the Effect equivalent of `Promise.all([...])`. It runs all extractors concurrently on the same pool.

**Keep existing `extractCatalog`** as-is for backward compatibility. The new `extractCatalogEffect` is used by the Effect pipeline.

`**createEmptyCatalog**` — This function deserializes a JSON fixture. It can stay as-is (async function) since it doesn't use a database. If needed, add an Effect version:

```typescript
export const createEmptyCatalogEffect = (
  version: number,
  currentUser: string,
): Effect.Effect<Catalog> =>
  Effect.promise(() => createEmptyCatalog(version, currentUser));
```

But this is low priority — it's called once and already handles its own errors.

---

## Execution Strategy

Since there are 28 extractors following the same pattern, use a systematic approach:

1. Start with `context.ts` and `depend.ts` (2 files, simplest extractors)
2. Then do the 25 object model extractors in alphabetical order
3. Finally update `catalog.model.ts`

For each file:

1. Add Effect import and DatabaseApi/CatalogExtractionError imports
2. Copy the existing function
3. Rename to `*Effect` suffix
4. Change `(pool: Pool)` to `(db: DatabaseApi)`
5. Change `async function` to `Effect.gen(function* ()`
6. Change `await pool.query(...)` to `yield* db.query<RowType>(...)`
7. Leave old function untouched

This is highly parallelizable — multiple extractors can be converted simultaneously since they don't depend on each other.

---

## Files Summary

| Action        | Count | Files                                                           |
| ------------- | ----- | --------------------------------------------------------------- |
| **Modify**    | 2     | `context.ts`, `depend.ts`                                       |
| **Modify**    | 25    | All object `*.model.ts` extractors                              |
| **Modify**    | 1     | `catalog.model.ts` (add `extractCatalogEffect`)                 |
| **Unchanged** | ~100+ | All `*.diff.ts`, `changes/*.ts`, sort, integrations, formatters |

## Verification Checklist

- `bun run check-types` passes
- `cd packages/pg-delta && bun test src/` passes (unit tests — no database needed)
- All `*Effect` extractor functions compile and type-check correctly
- `extractCatalogEffect` accepts `DatabaseApi` and returns `Effect.Effect<Catalog, CatalogExtractionError>`
- Old `extractCatalog(pool)` signature unchanged
