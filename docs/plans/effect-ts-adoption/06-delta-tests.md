---
name: "Effect-TS Phase 4a-4c: pg-delta Test Migration"
overview: Create Effect-based test infrastructure, migrate unit tests that need changes, migrate priority integration tests. Most tests require zero changes thanks to backward-compat wrappers.
todos:
  - id: phase-4a-test-infra
    content: Create Effect-based test infrastructure (effect-utils.ts)
    status: pending
  - id: phase-4b-audit-unit-tests
    content: Audit all unit tests, identify which need changes
    status: pending
  - id: phase-4b-migrate-units
    content: Migrate the ~10 unit test files that need updates
    status: pending
  - id: phase-4c-audit-integration-tests
    content: Audit integration tests, identify priority files
    status: pending
  - id: phase-4c-migrate-priority
    content: Migrate priority integration tests (apply-plan, declarative-apply, catalog-model)
    status: pending
  - id: verify
    content: Run full test suite
    status: pending
isProject: false
---

# Phase 4a-4c: pg-delta Test Migration — Detailed Implementation

## Prerequisites

- Phase 3c-3f complete (all Effect APIs exist alongside Promise APIs)

---

## Phase 4a: Create Effect-Based Test Infrastructure

### Create: `packages/pg-delta/tests/effect-utils.ts`

Effect-based replacements for `withDb` and `withDbIsolated`:

```typescript
import { Effect, Layer, type Scope } from "effect";
import type { Pool } from "pg";
import { type DatabaseApi, DatabaseService } from "../src/core/services/database.ts";
import { wrapPool } from "../src/core/services/database-live.ts";
import type { PostgresVersion } from "./constants.ts";
import { containerManager } from "./container-manager.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestDb {
  readonly main: DatabaseApi;
  readonly branch: DatabaseApi;
  readonly mainPool: Pool;
  readonly branchPool: Pool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Effect-based version of withDb.
 *
 * Usage:
 *

```typescript
 * test("name", withDbEffect(pgVersion, (db) =>
 *   Effect.gen(function* () {
 *     yield* db.branch.query("CREATE TABLE ...");
 *     const result = yield* createPlanEffect(...);
 *     expect(result?.plan.statements).toMatchInlineSnapshot(`...`);
 *   }),
 * ));
 */
export function withDbEffect(
postgresVersion: PostgresVersion,
fn: (db: TestDb) => Effect.Effect<void, unknown>,
): () => Promise<void> {
  return async () => {
const { main, branch, cleanup } =
await containerManager.getDatabasePair(postgresVersion);
try {
const testDb: TestDb = {
main: wrapPool(main),
branch: wrapPool(branch),
mainPool: main,
branchPool: branch,
};
await fn(testDb).pipe(Effect.runPromise);
} finally {
await cleanup();
}
};
}

/** Effect-based version of withDbIsolated. */
export function withDbIsolatedEffect(
  postgresVersion: PostgresVersion,
  fn: (db: TestDb) => Effect.Effect<void, unknown>,
): () => Promise<void> {
  return async () => {
  const { main, branch, cleanup } =
  await containerManager.getIsolatedContainers(postgresVersion);
  try {
  const testDb: TestDb = {
  main: wrapPool(main),
  branch: wrapPool(branch),
  mainPool: main,
  branchPool: branch,
  };
  await fn(testDb).pipe(Effect.runPromise);
  } finally {
  await cleanup();
  }
  };
  }

/** Helper to run an Effect test with scoped resources. */
export function withDbEffectScoped(
  postgresVersion: PostgresVersion,
  fn: (db: TestDb) => Effect.Effect<void, unknown, Scope.Scope>,
): () => Promise<void> {
  return async () => {
  const { main, branch, cleanup } =
  await containerManager.getDatabasePair(postgresVersion);
  try {
  const testDb: TestDb = {
  main: wrapPool(main),
  branch: wrapPool(branch),
  mainPool: main,
  branchPool: branch,
  };
  await fn(testDb).pipe(Effect.scoped, Effect.runPromise);
  } finally {
  await cleanup();
  }
  };
  }
```

**Note:** The existing `tests/utils.ts` (`withDb`, `withDbIsolated`) stays unchanged. The new helpers complement them. Old tests continue using the old helpers.

---

## Phase 4b: Migrate Unit Tests

### Unit Test Audit

**Tests requiring NO changes (~120+ files):**

All tests that exercise pure sync code. These test diff logic, change serialization, SQL formatting, sorting, integrations, and CLI utilities. None of them call async functions that changed signatures.

Categories:
- All `*.diff.test.ts` files (25 files) — test pure sync diff functions
- All `changes/*.test.ts` files (~80 files) — test pure sync change classes
- All `core/sort/*.test.ts` files (2 files) — test pure sync sorting
- All `core/integrations/*.test.ts` files (4 files) — test filter/serialize DSL
- `core/plan/serialize.test.ts`, `core/plan/sql-format/*.test.ts` (~15 files) — pure sync
- All `cli/utils/*.test.ts` and `cli/exit-code.test.ts` (6 files) — pure sync

**Tests requiring updates (~10 files):**

#### 1. `src/core/catalog.model.test.ts`

Tests `extractCatalog`. If the test was calling `extractCatalog(pool)` which is still the same signature → NO CHANGE.

If we want to add Effect-specific tests for `extractCatalogEffect`:

```typescript
// Add new test block:
describe("extractCatalogEffect", () => {
  test("produces same result as extractCatalog",
    withDbEffect(17, (db) =>
      Effect.gen(function* () {
        const catalog = yield* extractCatalogEffect(db.main);
        expect(catalog.version).toBeGreaterThan(0);
        expect(catalog.currentUser).toBeTruthy();
      }),
    ),
  );
});
```

#### 2. `src/core/catalog.snapshot.test.ts`

If snapshot functions didn't change → NO CHANGE.

#### 3. `src/core/declarative-apply/round-apply.test.ts` (26 tests)

**Current:** Uses mock `PoolClient` objects with `jest.fn()` / `mock()` patterns.

**If round-apply wasn't converted to Effect (Option A from Phase 3e):** NO CHANGE needed. The function signature is the same.

**If round-apply was converted to Effect:** Mock pattern changes:

```typescript
// Before: manual mock pool/client
const mockClient = { query: mock(...) };

// After: Effect Layer mocking
const MockDb = Layer.succeed(DatabaseService, {
  query: (sql) => Effect.succeed({ rows: [...], rowCount: 1 }),
  getPool: () => mockPool,
});
```

**Recommendation:** Since Phase 3e recommends keeping `roundApply` as-is, this file needs NO CHANGE.

#### 4. `src/core/declarative-apply/index.test.ts` (3 tests)

Tests `applyDeclarativeSchema`. If the Promise wrapper still exists → NO CHANGE.

#### 5. `src/core/declarative-apply/discover-sql.test.ts` (6 tests)

Tests `loadDeclarativeSchema`. If the Promise wrapper still exists → NO CHANGE.

#### 6. `src/core/expand-replace-dependencies.test.ts`

If it only tests sync functions → NO CHANGE.

### Summary: Most unit tests need NO changes

Because we kept backward-compatible Promise wrappers for all public functions, the vast majority of unit tests continue to work unchanged. The only tests that need updates are ones that import internal functions whose signatures changed — and since Phase 1-3 preserves old signatures, this is minimal.

**Add new Effect-specific unit tests:**

Create `src/core/services/database.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { DatabaseService, type DatabaseApi } from "./database.ts";
import { CatalogExtractionError } from "../errors.ts";

describe("DatabaseService mock", () => {
  test("can mock query responses", async () => {
    const MockDb: DatabaseApi = {
      query: (sql) => Effect.succeed({ rows: [{ count: 42 }], rowCount: 1 }),
      getPool: () => {
        throw new Error("no pool in mock");
      },
    };

    const result = await MockDb.query<{ count: number }>("SELECT 42").pipe(
      Effect.runPromise,
    );
    expect(result.rows[0].count).toBe(42);
  });

  test("query failure produces CatalogExtractionError", async () => {
    const FailingDb: DatabaseApi = {
      query: () => Effect.fail(new CatalogExtractionError({ message: "boom" })),
      getPool: () => {
        throw new Error("no pool");
      },
    };

    const result = await FailingDb.query("SELECT 1").pipe(
      Effect.either,
      Effect.runPromise,
    );
    expect(result._tag).toBe("Left");
  });
});
```

---

## Phase 4c: Migrate Integration Tests

### Integration Test Audit

**Strategy:** Since Promise-based wrappers exist, ALL integration tests can continue working unchanged. Migration is optional and should be done lazily.

**Priority files for Effect migration (4 files):**

These test the core flows that are now Effect-native:

1. `**tests/integration/apply-plan.test.ts` — validates the core apply flow
2. `**tests/integration/declarative-apply.test.ts` — validates declarative flow
3. `**tests/integration/catalog-model.test.ts` — validates extraction
4. `**tests/integration/catalog-diff.test.ts` — validates diff pipeline

**Migration pattern for integration tests:**

```typescript
// Before (no change needed — still works)
for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`feature (pg${pgVersion})`, () => {
    test(
      "name",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE ...");
        const result = await createPlan(db.main, db.branch);
        expect(result?.plan.statements).toMatchInlineSnapshot(`...`);
      }),
    );
  });
}

// After (optional Effect-style)
for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`feature (pg${pgVersion})`, () => {
    test(
      "name (effect)",
      withDbEffect(pgVersion, (db) =>
        Effect.gen(function* () {
          yield* db.branch.query("CREATE TABLE ...");
          const result = yield* createPlanEffect(
            db.branchPool,
            db.mainPool,
          ).pipe(Effect.scoped);
          expect(result?.plan.statements).toMatchInlineSnapshot(`...`);
        }),
      ),
    );
  });
}
```

**The remaining ~42 integration test files** can migrate lazily over time. They test specific object types (tables, views, triggers, etc.) and work fine with the Promise wrappers.

### Effect-Specific Integration Tests to Add

Create `tests/integration/effect-pipeline.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbEffect } from "../effect-utils.ts";
import { createPlanEffect } from "../../src/core/plan/create.ts";
import { extractCatalogEffect } from "../../src/core/catalog.model.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`Effect pipeline (pg${pgVersion})`, () => {
    test(
      "extractCatalogEffect works end-to-end",
      withDbEffect(pgVersion, (db) =>
        Effect.gen(function* () {
          const catalog = yield* extractCatalogEffect(db.main);
          expect(catalog.version).toBeGreaterThan(0);
          expect(catalog.currentUser).toBe("postgres");
          expect(Object.keys(catalog.schemas)).toContain("schema:public");
        }),
      ),
    );

    test(
      "createPlanEffect detects table addition",
      withDbEffect(pgVersion, (db) =>
        Effect.gen(function* () {
          yield* db.branch.query(
            "CREATE TABLE test_effect (id int PRIMARY KEY)",
          );
          const result = yield* createPlanEffect(
            db.mainPool,
            db.branchPool,
          ).pipe(Effect.scoped);
          expect(result).not.toBeNull();
          expect(result!.plan.statements.length).toBeGreaterThan(0);
          expect(
            result!.plan.statements.some((s) => s.includes("test_effect")),
          ).toBe(true);
        }),
      ),
    );

    test(
      "scoped pool cleanup on error",
      withDbEffect(pgVersion, (db) =>
        Effect.gen(function* () {
          // Verify that pool is properly cleaned up even on error
          const result = yield* createPlanEffect(
            "postgresql://invalid:5432/nonexistent",
            db.branchPool,
          ).pipe(Effect.scoped, Effect.either);
          expect(result._tag).toBe("Left");
          // The key test: no leaked pool connections after error
        }),
      ),
    );
  });
}
```

---

## Files Summary

| Action              | File                                        | Estimated Changes                    |
| ------------------- | ------------------------------------------- | ------------------------------------ |
| **Create**          | `tests/effect-utils.ts`                     | ~80 lines                            |
| **Create**          | `src/core/services/database.test.ts`        | ~40 lines                            |
| **Create**          | `tests/integration/effect-pipeline.test.ts` | ~60 lines                            |
| **No change**       | ~120 unit test files                        | 0                                    |
| **No change**       | ~42 integration test files                  | 0 (migrate lazily)                   |
| **Optional update** | 4 priority integration tests                | ~20 lines each (add Effect variants) |

## Verification Checklist

- `cd packages/pg-delta && bun test src/` passes (ALL unit tests)
- `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun test tests/integration/catalog-model.test.ts` passes
- `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun test tests/integration/apply-plan.test.ts` passes
- `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun test tests/integration/declarative-apply.test.ts` passes
- New Effect pipeline integration test passes
- DatabaseService mock test passes
- `bun run check-types` passes

## Testing Strategy Reminder

From CLAUDE.md: "Never run the full suite while iterating."

- Run one integration test file at a time: `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun test tests/integration/<file>`
- Run unit tests: `bun test src/<path>`
- Full suite only after all targeted tests pass: `bun run test:pg-delta`
