# API Reference

`@supabase/pg-delta` now exposes four library entrypoints:

- `@supabase/pg-delta` — canonical Effect-native root surface
- `@supabase/pg-delta/effect` — explicit Effect-native surface
- `@supabase/pg-delta/node` — Node promise facade over the shared Effect core
- `@supabase/pg-delta/adapters/node-pg` — explicit `pg` interop for pools and runtime layers

The Effect-native implementation is backed by `@effect/sql-pg@4.0.0-beta.31`,
with `pg-delta` adding its own SSL, session, and error-mapping policy on top.

## Installation

```bash
npm install @supabase/pg-delta
```

## Quick Start

### Effect-native

```typescript
import { Effect } from "effect";
import { applyPlan, createPlan } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

const planResult = await createPlan(
  "postgresql://localhost:5432/source_db",
  "postgresql://localhost:5432/target_db",
  { filter: supabase.filter, serialize: supabase.serialize },
).pipe(Effect.runPromise);

if (planResult) {
  const applyResult = await applyPlan(
    planResult.plan,
    "postgresql://localhost:5432/source_db",
    "postgresql://localhost:5432/target_db",
  ).pipe(Effect.runPromise);

  console.log(applyResult.status);
}
```

### Node Promise Facade

```typescript
import { applyPlan, createPlan } from "@supabase/pg-delta/node";

const planResult = await createPlan(sourceUrl, targetUrl);

if (planResult) {
  const applyResult = await applyPlan(planResult.plan, sourceUrl, targetUrl);
  console.log(applyResult.status);
}
```

## Exports

### Main / Effect Entry Points

```typescript
import {
  applyDeclarativeSchema,
  applyPlan,
  createPlan,
  DatabaseResolver,
  exportDeclarativeSchema,
  loadDeclarativeSchema,
  type CatalogInput,
  type CreatePlanOptions,
  type DatabaseApi,
  type IntegrationDSL,
  type Plan,
} from "@supabase/pg-delta";
```

`@supabase/pg-delta` and `@supabase/pg-delta/effect` share the same contract:

- They return `Effect.Effect` values.
- They do not expose `pg.Pool` in public types.
- URL-based helpers rely on the `DatabaseResolver` service at the boundary.

### Node Entry Point

```typescript
import {
  applyDeclarativeSchema,
  applyPlan,
  createPlan,
  extractCatalog,
  loadDeclarativeSchema,
} from "@supabase/pg-delta/node";
```

`@supabase/pg-delta/node` adapts the shared Effect programs into Promise APIs
and accepts `pg.Pool` inputs where appropriate.

### Explicit `pg` Adapter

```typescript
import {
  createManagedPool,
  fromNodePgPool,
  makeScopedDatabase,
  makeScopedDatabaseEffect,
  nodePgDatabaseResolverLayer,
} from "@supabase/pg-delta/adapters/node-pg";
```

Use this adapter when you need to:

- wrap an existing `pg.Pool` as a `DatabaseApi`
- provide the runtime resolver layer for URL-based Effect programs
- create a managed pool explicitly at the boundary

## Core Functions

### `createPlan(source, target, options?)`

Creates a migration plan by comparing two database states.

- `source`: `CatalogInput | null`
- `target`: `CatalogInput`
- `options`: `CreatePlanOptions | undefined`

On the Effect-native entrypoints, `CatalogInput` is:

- a connection string
- a `DatabaseApi`
- a catalog snapshot

It is not a `pg.Pool`. Adapt pools with `fromNodePgPool(pool)` or use
`@supabase/pg-delta/node`.

Effect-native return type:

```typescript
Effect.Effect<
  { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null,
  CreatePlanError,
  DatabaseResolver
>
```

### `applyPlan(plan, source, target, options?)`

Applies a migration plan with fingerprint validation before and after execution.

- `plan`: `Plan`
- `source`: `string | DatabaseApi` on Effect surfaces, `string | DatabaseApi | Pool` on `/node`
- `target`: `string | DatabaseApi` on Effect surfaces, `string | DatabaseApi | Pool` on `/node`
- `options?.verifyPostApply`: `boolean`

Node return type:

```typescript
type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };
```

### `applyDeclarativeSchema(options)`

Loads declarative SQL files, sorts them with `pg-topo`, plans the diff, and
applies the result to the target database.

On the Effect-native surface, filesystem and path access are injected services.
The `/node` entrypoint provides those layers automatically.

### `exportDeclarativeSchema(planResult, options?)`

Builds a declarative file layout from a non-null `createPlan` result.

## Migration Notes

### Moving off Effect-native `pg.Pool` usage

If older code passed `pg.Pool` directly into Effect-native APIs, switch to the
explicit adapter boundary:

```typescript
import { Effect } from "effect";
import { createPlan } from "@supabase/pg-delta";
import { fromNodePgPool } from "@supabase/pg-delta/adapters/node-pg";

const result = await createPlan(
  fromNodePgPool(sourcePool),
  fromNodePgPool(targetPool),
).pipe(Effect.runPromise);
```

### Moving off mixed runtime exports

Runtime-specific helpers no longer belong to `@supabase/pg-delta/effect` or
`@supabase/pg-delta/catalog-export`. Use `@supabase/pg-delta/adapters/node-pg`
for `pg` interop instead.

## Integrations

Integrations provide preconfigured filter and serialization rules:

```typescript
import { Effect } from "effect";
import { createPlan } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

const result = await createPlan(sourceUrl, targetUrl, {
  filter: supabase.filter,
  serialize: supabase.serialize,
}).pipe(Effect.runPromise);
```

See [Integrations](./integrations.md) for the full DSL documentation.
