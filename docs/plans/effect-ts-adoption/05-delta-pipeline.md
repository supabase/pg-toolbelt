---
name: "Effect-TS Phase 3c-3f: pg-delta Pipeline Conversion"
overview: Convert createPlan, applyPlan, declarative-apply, and export modules to Effect with scoped resources and typed errors.
todos:
  - id: phase-3c-create-plan
    content: Convert createPlan pipeline to Effect with scoped resources
    status: pending
  - id: phase-3d-apply-plan
    content: Convert applyPlan to Effect with typed errors
    status: pending
  - id: phase-3e-declarative-index
    content: Convert declarative-apply/index.ts orchestrator
    status: pending
  - id: phase-3e-round-apply
    content: Convert round-apply.ts to Effect
    status: pending
  - id: phase-3e-discover-sql
    content: Convert discover-sql.ts to Effect with FileSystem
    status: pending
  - id: phase-3f-export
    content: Wrap export module in Effect
    status: pending
  - id: phase-3-index
    content: Update src/index.ts with Effect exports
    status: pending
  - id: verify
    content: Run check-types + unit tests
    status: pending
isProject: false
---

# Phase 3c-3f: pg-delta Pipeline Conversion — Detailed Implementation

## Prerequisites

- Phase 3a-3b complete (all extractors and catalog have Effect versions)

---

## Phase 3c: Convert createPlan

### Modify: `packages/pg-delta/src/core/plan/create.ts`

**Current state (lines 58-110):** `createPlan` manually tracks pools in an array, resolves catalogs, builds plan, cleans up in `finally`.

**Add `createPlanEffect`:**

```typescript
import { Effect, type Scope } from "effect";
import { makeScopedPool, wrapPool } from "../services/database-live.ts";
import { extractCatalogEffect } from "../catalog.model.ts";
import { createEmptyCatalogEffect } from "../catalog.model.ts";
import type {
  ConnectionError,
  ConnectionTimeoutError,
  SslConfigError,
  CatalogExtractionError,
} from "../errors.ts";

export const createPlanEffect = (
  source: CatalogInput | null,
  target: CatalogInput,
  options: CreatePlanOptions = {},
): Effect.Effect<
  { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null,
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
  | CatalogExtractionError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const toCatalog = yield* resolveCatalogEffect(target, "target", options);

    const fromCatalog =
      source !== null
        ? yield* resolveCatalogEffect(source, "source", options)
        : yield* createEmptyCatalogEffect(
            toCatalog.version,
            toCatalog.currentUser,
          );

    // buildPlanForCatalogs is pure sync — stays unchanged (lines 115-196)
    return buildPlanForCatalogs(fromCatalog, toCatalog, options);
  });
```

**Add `resolveCatalogEffect` helper:**

```typescript
const resolveCatalogEffect = (
  input: CatalogInput,
  label: "source" | "target",
  options: CreatePlanOptions,
): Effect.Effect<
  Catalog,
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
  | CatalogExtractionError,
  Scope.Scope
> => {
  // Catalog instance — use directly
  if (input instanceof Catalog) {
    return Effect.succeed(input);
  }

  // String URL — create scoped pool, extract catalog
  if (typeof input === "string") {
    return Effect.gen(function* () {
      const db = yield* makeScopedPool(input, {
        role: options.role,
        label,
      });
      return yield* extractCatalogEffect(db);
    });
  }

  // Pool instance — wrap it, extract catalog (no lifecycle management)
  return extractCatalogEffect(wrapPool(input));
};
```

**Key improvement:** No more manual pool tracking array. `makeScopedPool` uses `Effect.acquireRelease` — the pool is automatically closed when the Scope finalizes, even on errors. This eliminates the `try/finally` pattern in current lines 93-109.

**Unchanged functions:** `buildPlanForCatalogs`, `cascadeExclusions`, `buildPlan`, `generateStatements`, `hasRoutineChanges` — all pure sync, stay as-is.

**Keep existing `createPlan`** as backward-compatible wrapper.

---

## Phase 3d: Convert applyPlan

### Modify: `packages/pg-delta/src/core/plan/apply.ts`

**Current state (lines 41-172):** Returns `ApplyPlanResult` union type with status discrimination. Manual pool management with `try/finally`.

**Current result type:**

```typescript
type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };
```

**After — errors go to the error channel, success is the happy path:**

```typescript
import { Effect, type Scope } from "effect";
import { makeScopedPool, wrapPool } from "../services/database-live.ts";
import {
  InvalidPlanError,
  FingerprintMismatchError,
  AlreadyAppliedError,
  PlanApplyError,
  type ConnectionError,
  type ConnectionTimeoutError,
  type SslConfigError,
  type CatalogExtractionError,
} from "../errors.ts";

type ApplyPlanSuccess = {
  statements: number;
  warnings?: string[];
};

export const applyPlanEffect = (
  plan: Plan,
  source: ConnectionInput,
  target: ConnectionInput,
  options: ApplyPlanOptions = {},
): Effect.Effect<
  ApplyPlanSuccess,
  | InvalidPlanError
  | FingerprintMismatchError
  | AlreadyAppliedError
  | PlanApplyError
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
  | CatalogExtractionError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    // Validate plan has statements
    if (!plan.statements || plan.statements.length === 0) {
      return yield* new InvalidPlanError({
        message: "Plan contains no SQL statements to execute.",
      });
    }

    // Resolve connections (scoped — auto-cleanup)
    const currentDb = yield* resolveConnectionEffect(
      source,
      plan.role,
      "source",
    );
    const desiredDb = yield* resolveConnectionEffect(
      target,
      plan.role,
      "target",
    );

    // Extract catalogs in parallel
    const [currentCatalog, desiredCatalog] = yield* Effect.all(
      [extractCatalogEffect(currentDb), extractCatalogEffect(desiredDb)],
      { concurrency: 2 },
    );

    // Recompute fingerprints (same logic as current lines 88-106)
    const changes = diffCatalogs(currentCatalog, desiredCatalog);
    const ctx: DiffContext = {
      mainCatalog: currentCatalog,
      branchCatalog: desiredCatalog,
    };

    let filteredChanges = changes;
    if (plan.filter) {
      const filterFn = compileFilterDSL(plan.filter);
      filteredChanges = filteredChanges.filter((change) => filterFn(change));
    }

    const sortedChanges = sortChanges(ctx, filteredChanges);
    const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
      ctx.mainCatalog,
      sortedChanges,
    );

    // Pre-apply fingerprint validation
    if (fingerprintFrom === plan.target.fingerprint) {
      return yield* new AlreadyAppliedError({});
    }

    if (fingerprintFrom !== plan.source.fingerprint) {
      return yield* new FingerprintMismatchError({
        current: fingerprintFrom,
        expected: plan.source.fingerprint,
      });
    }

    // Execute the SQL script
    const script = (() => {
      const joined = plan.statements.join(";\n");
      return joined.endsWith(";") ? joined : `${joined};`;
    })();

    yield* currentDb
      .query(script)
      .pipe(
        Effect.mapError((err) => new PlanApplyError({ cause: err, script })),
      );

    // Post-apply verification
    const warnings: string[] = [];
    if (options.verifyPostApply !== false) {
      const verifyResult = yield* Effect.either(
        extractCatalogEffect(currentDb).pipe(
          Effect.map((updatedCatalog) => {
            const updatedFingerprint = hashStableIds(updatedCatalog, stableIds);
            if (updatedFingerprint !== plan.target.fingerprint) {
              return "Post-apply fingerprint does not match the plan target fingerprint.";
            }
            return null;
          }),
        ),
      );
      if (verifyResult._tag === "Left") {
        warnings.push(
          `Could not verify post-apply fingerprint: ${verifyResult.left.message}`,
        );
      } else if (verifyResult.right) {
        warnings.push(verifyResult.right);
      }
    }

    const changeStatements = plan.statements.filter(
      (stmt) => !isSessionStatement(stmt),
    );

    return {
      statements: changeStatements.length,
      warnings: warnings.length ? warnings : undefined,
    };
  });

const resolveConnectionEffect = (
  input: ConnectionInput,
  role: string | undefined,
  label: "source" | "target",
): Effect.Effect<
  DatabaseApi,
  ConnectionError | ConnectionTimeoutError | SslConfigError,
  Scope.Scope
> => {
  if (typeof input === "string") {
    return makeScopedPool(input, { role, label });
  }
  return Effect.succeed(wrapPool(input));
};
```

**Keep existing `applyPlan`** as backward-compatible wrapper.

---

## Phase 3e: Convert Declarative Apply

### Modify: `packages/pg-delta/src/core/declarative-apply/index.ts`

**Current state (lines 93-198):** `applyDeclarativeSchema` creates a managed pool, runs pg-topo analysis, remaps IDs, runs `roundApply`, cleans up.

**Add `applyDeclarativeSchemaEffect`:**

```typescript
import { Effect, type Scope } from "effect";
import { makeScopedPool, wrapPool } from "../services/database-live.ts";
import type { DatabaseApi } from "../services/database.ts";
import { analyzeAndSort } from "@supabase/pg-topo";
import type { DeclarativeApplyError, ConnectionError, StuckError } from "../errors.ts";

export const applyDeclarativeSchemaEffect = (
  options: DeclarativeApplyOptions,
): Effect.Effect<
  DeclarativeApplyResult,
  ConnectionError | DeclarativeApplyError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const { content, targetUrl, pool: providedPool, maxRounds = 100, ... } = options;

    if (content.length === 0) {
      return { apply: { status: "success", ... }, diagnostics: [], totalStatements: 0 };
    }

    // Resolve pool (scoped if created from URL)
    let pool: import("pg").Pool;
    if (providedPool != null) {
      pool = providedPool;
    } else if (targetUrl != null) {
      const db = yield* makeScopedPool(targetUrl, { label: "target" });
      pool = db.getPool();
    } else {
      return yield* new DeclarativeApplyError({
        message: "Either targetUrl or pool must be provided",
      });
    }

    // The rest follows current logic but with pool lifecycle handled by Scope:
    const externalProviders = yield* Effect.promise(
      () => extractCatalogProviders(pool),
    );

    const sqlContents = content.map((entry) => entry.sql);
    const analyzeResult = yield* Effect.promise(
      () => analyzeAndSort(sqlContents, { externalProviders }),
    );

    // ... remapping logic (lines 144-161) — unchanged ...
    // ... convert to statements and apply (lines 177-186) ...

    const applyResult = yield* Effect.promise(
      () => roundApply({ pool, statements, maxRounds, ... }),
    );

    return { apply: applyResult, diagnostics: remappedDiagnostics, totalStatements: ... };
  });
```

**Note:** `roundApply` stays as an async function internally for now. It operates on a `PoolClient` directly with savepoints and transaction control. Converting its internal loop to Effect would be Phase 3e-deep (optional). The Effect version here wraps it with `Effect.promise`.

### Modify: `packages/pg-delta/src/core/declarative-apply/round-apply.ts`

**Option A (minimal, recommended for this phase):** Keep `roundApply` as-is. It's a complex state machine (418 lines) with `PoolClient` transaction management, savepoints, and error classification. Wrapping it with `Effect.promise` in the orchestrator is sufficient.

**Option B (full conversion):** Would convert the round loop to Effect. Each statement execution becomes:

```typescript
const executeStatement = (
  client: PoolClient,
  sql: string,
  statementClass?: string,
): Effect.Effect<"applied" | "deferred" | "skipped", StatementError> =>
  Effect.tryPromise({
    try: () => client.query(sql),
    catch: (err) => {
      const pgErr = err as PgError;
      const code = pgErr.code ?? "";
      const message = (pgErr.message ?? "").toLowerCase();

      if (isEnvironmentCapabilityError(code, message, statementClass)) {
        // Use a typed error to signal "skip"
        // ...
      }
      if (isDependencyError(code)) {
        // Use a typed error to signal "defer"
        // ...
      }
      // Hard failure
      return { statement: ..., code, message, ... };
    },
  }).pipe(Effect.map(() => "applied" as const));
```

**Recommendation:** Go with Option A for this phase. The round-apply loop has complex control flow (savepoints, validation pass, per-round progress callbacks) that would require significant restructuring. Wrap it and move on.

### Modify: `packages/pg-delta/src/core/declarative-apply/discover-sql.ts`

**Current state (108 lines):** Uses `node:fs/promises` for file discovery and reading.

**Add `loadDeclarativeSchemaEffect`:**

```typescript
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import path from "node:path";
import type { FileDiscoveryError } from "../errors.ts";

export const loadDeclarativeSchemaEffect = (
  schemaPath: string,
): Effect.Effect<SqlFileEntry[], FileDiscoveryError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const resolvedRoot = path.resolve(schemaPath);

    const exists = yield* fs.exists(resolvedRoot);
    if (!exists) {
      return yield* Effect.fail(
        new FileDiscoveryError({
          message: `Cannot access '${schemaPath}': path does not exist`,
          path: schemaPath,
        }),
      );
    }

    const info = yield* fs.stat(resolvedRoot);
    let files: string[];
    let basePath: string;

    if (info.type === "File") {
      if (!resolvedRoot.toLowerCase().endsWith(".sql")) {
        return yield* Effect.fail(
          new FileDiscoveryError({
            message: `Path is not a .sql file: '${schemaPath}'`,
            path: schemaPath,
          }),
        );
      }
      files = [resolvedRoot];
      basePath = path.dirname(resolvedRoot);
    } else if (info.type === "Directory") {
      const fileSet = new Set<string>();
      yield* readSqlFilesInDirectoryEffect(resolvedRoot, fileSet);
      files = [...fileSet].sort((a, b) => a.localeCompare(b));
      basePath = resolvedRoot;
    } else {
      return yield* Effect.fail(
        new FileDiscoveryError({
          message: `Path is not a file or directory: '${schemaPath}'`,
          path: schemaPath,
        }),
      );
    }

    const entries: SqlFileEntry[] = [];
    for (const filePath of files) {
      const sql = yield* fs.readFileString(filePath, "utf-8").pipe(
        Effect.mapError(
          () =>
            new FileDiscoveryError({
              message: `Cannot read file '${toStablePath(filePath, basePath)}'`,
              path: filePath,
            }),
        ),
      );
      entries.push({ filePath: toStablePath(filePath, basePath), sql });
    }

    return entries;
  });

const readSqlFilesInDirectoryEffect = (
  directoryPath: string,
  outFiles: Set<string>,
): Effect.Effect<void, FileDiscoveryError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(directoryPath);
    const sortedEntries = [...entries].sort((a, b) => a.localeCompare(b));

    for (const entryName of sortedEntries) {
      const fullPath = path.join(directoryPath, entryName);
      const info = yield* fs.stat(fullPath);
      if (info.type === "Directory") {
        yield* readSqlFilesInDirectoryEffect(fullPath, outFiles);
      } else if (
        info.type === "File" &&
        fullPath.toLowerCase().endsWith(".sql")
      ) {
        outFiles.add(path.resolve(fullPath));
      }
    }
  });
```

**Keep existing `loadDeclarativeSchema`** as-is for backward compatibility.

---

## Phase 3f: Convert Export Module

### Modify: `packages/pg-delta/src/core/export/index.ts`

**Current state (130 lines):** `exportDeclarativeSchema` is pure sync — takes a `PlanResult`, generates file entries. No async operations.

**Wrap in Effect for consistency:**

```typescript
import { Effect } from "effect";

export const exportDeclarativeSchemaEffect = (
  planResult: PlanResult,
  options?: ExportOptions,
): Effect.Effect<DeclarativeSchemaOutput> =>
  Effect.sync(() => exportDeclarativeSchema(planResult, options));
```

That's it. The function is already pure sync. Wrapping in `Effect.sync` makes it composable with other Effects but adds no real logic.

**Keep `exportDeclarativeSchema`** unchanged — it's the primary export and callers use it directly.

---

## Phase 3-final: Update src/index.ts

### Modify: `packages/pg-delta/src/index.ts`

Add Effect-native exports:

```typescript
// Effect-native exports
export { createPlanEffect, type CatalogInput } from "./core/plan/create.ts";
export { applyPlanEffect } from "./core/plan/apply.ts";
export { extractCatalogEffect } from "./core/catalog.model.ts";
export { applyDeclarativeSchemaEffect } from "./core/declarative-apply/index.ts";
export { loadDeclarativeSchemaEffect } from "./core/declarative-apply/discover-sql.ts";
export { exportDeclarativeSchemaEffect } from "./core/export/index.ts";
export { DatabaseService, type DatabaseApi } from "./core/services/database.ts";
export { makeScopedPool, wrapPool } from "./core/services/database-live.ts";
export {
  ConnectionError,
  ConnectionTimeoutError,
  CatalogExtractionError,
  InvalidPlanError,
  FingerprintMismatchError,
  AlreadyAppliedError,
  PlanApplyError,
  DeclarativeApplyError,
  StuckError,
  SslConfigError,
  FileDiscoveryError,
  PlanDeserializationError,
} from "./core/errors.ts";

// Existing exports stay unchanged
export {
  Catalog,
  createEmptyCatalog,
  extractCatalog,
} from "./core/catalog.model.ts";
export { createPlan } from "./core/plan/create.ts";
export { applyPlan } from "./core/plan/apply.ts";
// ... rest of existing exports ...
```

---

## Files Summary

| Action        | File                                         | Estimated Changes                   |
| ------------- | -------------------------------------------- | ----------------------------------- |
| **Modify**    | `src/core/plan/create.ts`                    | ~60 lines (add Effect version)      |
| **Modify**    | `src/core/plan/apply.ts`                     | ~80 lines (add Effect version)      |
| **Modify**    | `src/core/declarative-apply/index.ts`        | ~50 lines (add Effect version)      |
| **Modify**    | `src/core/declarative-apply/discover-sql.ts` | ~70 lines (add Effect version)      |
| **Modify**    | `src/core/declarative-apply/round-apply.ts`  | 0 (kept as-is, wrapped externally)  |
| **Modify**    | `src/core/export/index.ts`                   | ~5 lines (trivial Effect.sync wrap) |
| **Modify**    | `src/index.ts`                               | ~30 lines (add new exports)         |
| **Unchanged** | All diff, change, sort, integration files    | 0                                   |

## Verification Checklist

- `bun run check-types` passes
- `cd packages/pg-delta && bun test src/` passes (unit tests)
- `createPlanEffect` compiles with correct error/service types
- `applyPlanEffect` compiles with correct error/service types
- `applyDeclarativeSchemaEffect` compiles with correct error/service types
- Old Promise-based API signatures are unchanged
- New Effect exports are available from `@supabase/pg-delta`
