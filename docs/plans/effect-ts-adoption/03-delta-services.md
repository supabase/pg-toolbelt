---
name: "Effect-TS Phase 2a-2c: pg-delta Services, Errors, Schema"
overview: Define pg-delta tagged error types, create DatabaseService wrapping pg Pool with Effect, replace Zod with Effect Schema for Plan validation.
todos:
  - id: phase-2a-errors
    content: Create src/core/errors.ts with tagged error types
    status: pending
  - id: phase-2b-db-service-interface
    content: Create src/core/services/database.ts (interface)
    status: pending
  - id: phase-2b-db-service-live
    content: Create src/core/services/database-live.ts (scoped pool implementation)
    status: pending
  - id: phase-2c-schema
    content: Replace Zod with Effect Schema in plan/types.ts and plan/io.ts
    status: pending
  - id: phase-2c-remove-zod
    content: Remove zod from package.json dependencies
    status: pending
  - id: phase-2c-update-model-schemas
    content: Replace Zod schemas in *.model.ts files with Effect Schema
    status: pending
  - id: verify
    content: Run check-types + unit tests
    status: pending
isProject: false
---

# Phase 2a-2c: pg-delta Services, Errors, Schema — Detailed Implementation

## Prerequisites

- Phase 0 complete (Effect packages installed)

---

## Phase 2a: Define Typed Error Types

### Create: `packages/pg-delta/src/core/errors.ts`

Map existing error patterns to tagged Effect errors. Each error type replaces a specific `throw new Error(...)` or union member in the current code.

```typescript
import { Data } from "effect";

// ---------------------------------------------------------------------------
// Connection errors
// ---------------------------------------------------------------------------

// Replaces: throw in postgres-config.ts:213 catch block
// Replaces: "Connection to ... timed out" in postgres-config.ts:202-206
export class ConnectionError extends Data.TaggedError("ConnectionError")<{
  readonly message: string;
  readonly label: "source" | "target";
  readonly cause?: unknown;
}> {}

// Replaces: the setTimeout rejection in postgres-config.ts:199-209
export class ConnectionTimeoutError extends Data.TaggedError(
  "ConnectionTimeoutError",
)<{
  readonly message: string;
  readonly label: "source" | "target";
  readonly timeoutMs: number;
}> {}

// ---------------------------------------------------------------------------
// Catalog errors
// ---------------------------------------------------------------------------

// Replaces: unhandled promise rejections from pool.query in extractors
export class CatalogExtractionError extends Data.TaggedError(
  "CatalogExtractionError",
)<{
  readonly message: string;
  readonly extractor?: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Plan errors
// ---------------------------------------------------------------------------

// Replaces: ApplyPlanResult { status: "invalid_plan" } in apply.ts:16
export class InvalidPlanError extends Data.TaggedError("InvalidPlanError")<{
  readonly message: string;
}> {}

// Replaces: ApplyPlanResult { status: "fingerprint_mismatch" } in apply.ts:17
export class FingerprintMismatchError extends Data.TaggedError(
  "FingerprintMismatchError",
)<{
  readonly current: string;
  readonly expected: string;
}> {}

// Replaces: ApplyPlanResult { status: "failed" } in apply.ts:20
export class PlanApplyError extends Data.TaggedError("PlanApplyError")<{
  readonly cause: unknown;
  readonly script: string;
}> {}

// Replaces: ApplyPlanResult { status: "already_applied" } in apply.ts:18
export class AlreadyAppliedError extends Data.TaggedError(
  "AlreadyAppliedError",
)<{}> {}

// ---------------------------------------------------------------------------
// Declarative apply errors
// ---------------------------------------------------------------------------

// Replaces: throw new Error("Either targetUrl or pool...") in declarative-apply/index.ts:129
export class DeclarativeApplyError extends Data.TaggedError(
  "DeclarativeApplyError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Replaces: ApplyResult { status: "stuck" } in round-apply.ts:413,438
export class StuckError extends Data.TaggedError("StuckError")<{
  readonly message: string;
  readonly stuckStatements: readonly string[];
}> {}

// ---------------------------------------------------------------------------
// SSL/config errors
// ---------------------------------------------------------------------------

// Replaces: thrown errors from parseSslConfig in plan/ssl-config.ts
export class SslConfigError extends Data.TaggedError("SslConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// File I/O errors (declarative schema discovery)
// ---------------------------------------------------------------------------

// Replaces: throw new Error("Cannot access...") in discover-sql.ts:67
// Replaces: throw new Error("Path is not a .sql file...") in discover-sql.ts:75
// Replaces: throw new Error("Path is not a file or directory...") in discover-sql.ts:85
// Replaces: throw new Error("Cannot read file...") in discover-sql.ts:102
export class FileDiscoveryError extends Data.TaggedError("FileDiscoveryError")<{
  readonly message: string;
  readonly path: string;
}> {}

// ---------------------------------------------------------------------------
// Plan I/O errors
// ---------------------------------------------------------------------------

// Replaces: JSON.parse/Zod parse errors in plan/io.ts:18-19
export class PlanDeserializationError extends Data.TaggedError(
  "PlanDeserializationError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
```

---

## Phase 2b: Create DatabaseService

### Design Decision: Keep `pg` (node-postgres)

`@effect/sql-pg` uses `postgres.js`, NOT `node-postgres` (`pg`). Since pg-delta has:

- 28 extractors with SQL queries built on `Pool.query()`
- Custom type parsers (bigint → BigInt, arrays, int2vector) in `postgres-config.ts` (lines 82-105)
- SSL handling via `parseSslConfig`

Switching to `postgres.js` would require rewriting every SQL query. Instead, we create a custom Effect Service wrapping the existing `pg` library.

### Create: `packages/pg-delta/src/core/services/database.ts`

Service interface:

```typescript
import { Context, type Effect } from "effect";
import type { Pool } from "pg";
import type { CatalogExtractionError } from "../errors.ts";

export interface DatabaseApi {
  /** Execute a parameterized query */
  readonly query: <R = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => Effect.Effect<
    { rows: R[]; rowCount: number | null },
    CatalogExtractionError
  >;
  /** Access the underlying pg Pool (escape hatch for code not yet migrated) */
  readonly getPool: () => Pool;
}

export class DatabaseService extends Context.Tag("@pg-delta/DatabaseService")<
  DatabaseService,
  DatabaseApi
>() {}
```

**Note:** `getPool()` is an escape hatch so partially-migrated code can still access the raw Pool. It should be removed once all extractors use `DatabaseApi.query`.

### Create: `packages/pg-delta/src/core/services/database-live.ts`

Scoped pool implementation wrapping the existing `createManagedPool`:

```typescript
import { Effect, type Scope } from "effect";
import { escapeIdentifier } from "pg";
import type { DatabaseApi } from "./database.ts";
import { createPool, endPool } from "../postgres-config.ts";
import { parseSslConfig } from "../plan/ssl-config.ts";
import {
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  SslConfigError,
} from "../errors.ts";

const DEFAULT_CONNECT_TIMEOUT_MS =
  Number(process.env.PGDELTA_CONNECT_TIMEOUT_MS) || 2_500;

/**
 * Create a DatabaseApi backed by a scoped pg Pool.
 * The pool is automatically closed when the Scope finalizes.
 *
 * This replaces the manual try/finally pool cleanup pattern in
 * create.ts (lines 93-109) and apply.ts (lines 54-80, 164-170).
 */
export const makeScopedPool = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
): Effect.Effect<
  DatabaseApi,
  ConnectionError | ConnectionTimeoutError | SslConfigError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const label = options?.label ?? "target";

    // Parse SSL config
    const sslConfig = yield* Effect.tryPromise({
      try: () => parseSslConfig(url, label),
      catch: (err) =>
        new SslConfigError({
          message: `SSL config failed for ${label}: ${err}`,
          cause: err,
        }),
    });

    // Create pool with acquireRelease for automatic cleanup
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createPool(sslConfig.cleanedUrl, {
          ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
          onError: (err: Error & { code?: string }) => {
            if (err.code !== "57P01") {
              console.error("Pool error:", err);
            }
          },
          onConnect: async (client) => {
            await client.query("SET search_path = ''");
            if (options?.role) {
              await client.query(`SET ROLE ${escapeIdentifier(options.role)}`);
            }
          },
        }),
      ),
      (pool) => Effect.promise(() => endPool(pool)),
    );

    // Validate connectivity with timeout
    yield* Effect.tryPromise({
      try: async () => {
        const timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS;
        const client = await Promise.race([
          pool.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error(`Connection timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]);
        client.release();
      },
      catch: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("timed out")) {
          return new ConnectionTimeoutError({
            message: `Connection to ${label} database timed out after ${DEFAULT_CONNECT_TIMEOUT_MS}ms`,
            label,
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
          });
        }
        return new ConnectionError({
          message: `Failed to connect to ${label} database: ${msg}`,
          label,
          cause: err,
        });
      },
    });

    // Return the DatabaseApi
    const api: DatabaseApi = {
      query: (sql, values) =>
        Effect.tryPromise({
          try: () => pool.query(sql, values),
          catch: (err) =>
            new CatalogExtractionError({
              message: `Query failed: ${err instanceof Error ? err.message : err}`,
              cause: err,
            }),
        }),
      getPool: () => pool,
    };
    return api;
  });

/**
 * Wrap an existing pg Pool as a DatabaseApi (no lifecycle management).
 * Used when the caller owns the pool (e.g. declarative-apply with provided pool).
 */
export const wrapPool = (pool: import("pg").Pool): DatabaseApi => ({
  query: (sql, values) =>
    Effect.tryPromise({
      try: () => pool.query(sql, values),
      catch: (err) =>
        new CatalogExtractionError({
          message: `Query failed: ${err instanceof Error ? err.message : err}`,
          cause: err,
        }),
    }),
  getPool: () => pool,
});
```

**Key benefit:** Pool lifecycle is now managed by `Scope`. No more manual `try/finally` cleanup patterns. When an Effect scope closes, all acquired pools are automatically released.

**Existing code preserved:** `postgres-config.ts` keeps `createPool`, `endPool`, `createManagedPool` unchanged — they're used by the new Effect code internally and by any Promise-based callers that haven't migrated yet.

---

## Phase 2c: Replace Zod with Effect Schema

### Modify: `packages/pg-delta/src/core/plan/types.ts`

**Current state (lines 1-11, 124-153):** Uses `zod` for `PlanSchema` validation.

**Changes:** Replace `z.object(...)` with `Schema.Struct(...)`:

```typescript
// Before (lines 1-6):
import z from "zod";

// After:
import { Schema } from "effect";

// Before (lines 124-148):
export const PlanSchema = z.object({
  version: z.number(),
  toolVersion: z.string().optional(),
  source: z.object({ fingerprint: z.string() }),
  target: z.object({ fingerprint: z.string() }),
  statements: z.array(z.string()),
  role: z.string().optional(),
  filter: z.any().optional(),
  serialize: z.any().optional(),
  risk: z
    .discriminatedUnion("level", [
      z.object({ level: z.literal("safe") }),
      z.object({
        level: z.literal("data_loss"),
        statements: z.array(z.string()),
      }),
    ])
    .optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

// After:
export const PlanRiskSchema = Schema.Union(
  Schema.Struct({ level: Schema.Literal("safe") }),
  Schema.Struct({
    level: Schema.Literal("data_loss"),
    statements: Schema.Array(Schema.String),
  }),
);

export const PlanSchema = Schema.Struct({
  version: Schema.Number,
  toolVersion: Schema.optional(Schema.String),
  source: Schema.Struct({ fingerprint: Schema.String }),
  target: Schema.Struct({ fingerprint: Schema.String }),
  statements: Schema.Array(Schema.String),
  role: Schema.optional(Schema.String),
  filter: Schema.optional(Schema.Unknown),
  serialize: Schema.optional(Schema.Unknown),
  risk: Schema.optional(PlanRiskSchema),
});

export type Plan = typeof PlanSchema.Type;
```

**Note:** `PlanRisk` type (line 16-18) can now be derived from the schema too:

```typescript
export type PlanRisk = typeof PlanRiskSchema.Type;
```

### Modify: `packages/pg-delta/src/core/plan/io.ts`

**Current (line 18-19):**

```typescript
export function deserializePlan(json: string): Plan {
  const parsed = JSON.parse(json);
  return PlanSchema.parse(parsed);
}
```

**After:**

```typescript
import { Schema } from "effect";
import { type Plan, PlanSchema } from "./types.ts";

export function serializePlan(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

export function deserializePlan(json: string): Plan {
  const parsed = JSON.parse(json);
  return Schema.decodeUnknownSync(PlanSchema)(parsed);
}
```

`Schema.decodeUnknownSync` throws on validation failure, same as `z.parse()`. For an Effect-native version:

```typescript
import { Effect } from "effect";
import { PlanDeserializationError } from "../errors.ts";

export const deserializePlanEffect = (
  json: string,
): Effect.Effect<Plan, PlanDeserializationError> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(json);
      return Schema.decodeUnknownSync(PlanSchema)(parsed);
    },
    catch: (err) =>
      new PlanDeserializationError({
        message: `Failed to parse plan: ${err instanceof Error ? err.message : err}`,
        cause: err,
      }),
  });
```

### Replace Zod in model files

**Files using Zod:** Several `*.model.ts` files import `z from "zod"` for row validation schemas. This is a significant sub-task.

**Approach:** Use `Schema.decodeUnknownSync` where `z.parse()` was used. The Zod schemas in model files validate raw SQL query results from PostgreSQL.

**Example — `table.model.ts` (lines 1-5, 16-36):**

```typescript
// Before:
import z from "zod";
const RelationPersistenceSchema = z.enum(["p", "u", "t"]);

// After:
import { Schema } from "effect";
const RelationPersistenceSchema = Schema.Literal("p", "u", "t");
```

**Mapping reference:**

| Zod                         | Effect Schema                            |
| --------------------------- | ---------------------------------------- |
| `z.string()`                | `Schema.String`                          |
| `z.number()`                | `Schema.Number`                          |
| `z.boolean()`               | `Schema.Boolean`                         |
| `z.literal("x")`            | `Schema.Literal("x")`                    |
| `z.enum(["a","b"])`         | `Schema.Literal("a", "b")`               |
| `z.array(z.string())`       | `Schema.Array(Schema.String)`            |
| `z.object({...})`           | `Schema.Struct({...})`                   |
| `z.string().optional()`     | `Schema.optional(Schema.String)`         |
| `z.string().nullable()`     | `Schema.NullOr(Schema.String)`           |
| `z.any()`                   | `Schema.Unknown`                         |
| `z.discriminatedUnion(...)` | `Schema.Union(...)`                      |
| `schema.parse(data)`        | `Schema.decodeUnknownSync(schema)(data)` |
| `z.infer<typeof Schema>`    | `typeof Schema.Type`                     |

**List of model files with Zod imports to migrate:**

Search for `from "zod"` or `from 'zod'` across all `.model.ts` files. Common ones:

- `table.model.ts` — multiple Zod schemas for constraints, columns, partitions
- `view.model.ts` — view options
- `materialized-view.model.ts` — similar to view
- `base.model.ts` — base column schema
- Others — check each for `z.` usage

**Important:** This is the most tedious part of Phase 2c. Each model file's Zod schemas need 1:1 translation. The logic stays identical; only the import and API change.

### Remove Zod dependency

After all `z from "zod"` imports are replaced:

```bash
cd packages/pg-delta
bun remove zod
```

**Verify:** `rg 'from "zod"' src/` returns no results.

---

## Files Summary

| Action        | File                                    | Estimated Changes                     |
| ------------- | --------------------------------------- | ------------------------------------- |
| **Create**    | `src/core/errors.ts`                    | ~80 lines                             |
| **Create**    | `src/core/services/database.ts`         | ~25 lines                             |
| **Create**    | `src/core/services/database-live.ts`    | ~100 lines                            |
| **Modify**    | `src/core/plan/types.ts`                | ~30 lines (Zod → Schema)              |
| **Modify**    | `src/core/plan/io.ts`                   | ~10 lines (parse → decodeUnknownSync) |
| **Modify**    | `src/core/objects/table/table.model.ts` | ~30 lines (Zod → Schema)              |
| **Modify**    | Multiple `*.model.ts` files             | ~5-30 lines each                      |
| **Modify**    | `package.json`                          | Remove `zod` dep                      |
| **Unchanged** | `postgres-config.ts`                    | 0 (kept for internal use)             |

## Verification Checklist

- `bun run check-types` passes
- `cd packages/pg-delta && bun test src/` passes (all unit tests)
- `rg 'from "zod"' packages/pg-delta/src/` returns 0 results
- `DatabaseService` interface compiles and can be instantiated
- `makeScopedPool` compiles (full test in Phase 4)
- `deserializePlan` still correctly validates plan JSON
- All model Zod schemas are replaced with Effect Schema equivalents
