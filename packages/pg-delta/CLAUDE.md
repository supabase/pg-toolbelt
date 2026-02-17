# CLAUDE.md -- @supabase/pg-delta

## What This Package Does

PostgreSQL schema diff and migration tool. Connects to two PostgreSQL databases (source + target), extracts their catalogs, diffs them, and generates ordered DDL migration scripts. Safety-first: detects data-loss operations and supports a plan-based workflow for preview and version control.

## Commands

```bash
bun test              # All tests (unit + integration)
bun test src/         # Unit tests only (no Docker)
bun test tests/       # Integration tests (Docker required)
bun run build         # Compile with tsc
bun run check-types   # Type check without emitting
bun run pgdelta       # Run CLI (e.g. bun run pgdelta plan --help)
```

## Test Patterns

### Unit tests (`src/**/*.test.ts`)

```typescript
import { describe, expect, test } from "bun:test";
```

No database needed. Test change classes, diff logic, SQL formatting.

### Integration tests (`tests/**/*.test.ts`)

```typescript
import { describe, test } from "bun:test";
import { withDb, withDbIsolated } from "../utils.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`feature (pg${pgVersion})`, () => {
    // Fast: shared container, database-level isolation
    test("test name", withDb(pgVersion, async (db) => {
      // db.main, db.branch are pg Pool instances
    }));

    // Slow: fresh containers per test, full isolation
    test("isolated test", withDbIsolated(pgVersion, async (db) => {
      // db.main, db.branch are pg Pool instances
    }));
  });
}
```

### Key files

- `tests/utils.ts` -- `withDb`, `withDbIsolated`, `withDbSupabaseIsolated` wrappers
- `tests/container-manager.ts` -- Singleton container pool management
- `tests/integration/roundtrip.ts` -- Core roundtrip fidelity test helper
- `tests/constants.ts` -- PostgreSQL version config (reads `PGDELTA_TEST_POSTGRES_VERSIONS` env)
- `tests/global-setup.ts` -- Preload for integration test container lifecycle

## Architecture

### Core (`src/core/`)

- **Catalog**: `catalog.model.ts`, `catalog.diff.ts` — extract and diff catalogs; each object type has an extractor and diff.
- **postgres-config.ts** — pg Pool factory with custom type parsers (bigint, arrays, int2vector).
- **objects/** — Per-object-type modules (table, function, view, role, etc.):
  - `<type>.model.ts` — Types and catalog extraction.
  - `<type>.diff.ts` — Diff logic.
  - `changes/` — create, alter, drop, comment, privilege; each implements `serialize()` and `depends`.
- **sort/** — Dependency-aware change sorting (two-phase: DROP then CREATE/ALTER; topological + logical grouping).
- **plan/** — Migration plan generation and SQL formatting (`create.ts`, `apply.ts`, `risk.ts`, `sql-format/`).
- **integrations/** — Filter and serialization DSL; `filter/dsl.ts`, `serialize/dsl.ts`, `supabase.ts`.

### CLI (`src/cli/`)

- `bin/cli.ts` — Entry point.
- `app.ts` — Stricli CLI framework.
- `commands/` — plan, apply, sync, declarative-export, declarative-apply, etc.
- `formatters/` — Tree view, SQL scripts.
- `utils.ts` — Shared CLI helpers.

## Key Concepts

### Change object structure

Every change has: **type**, **operation** (create/alter/drop), **scope** (object/comment/privilege/membership), **properties**, **serialize()**, and **depends** (array of stable identifiers).

### Stable identifiers

Used to track objects across databases (OIDs differ per environment):

- Schema objects: `type:schema.name` (e.g. `table:public.users`).
- Sub-entities: `type:schema.parent.name` (e.g. `column:public.users.email`).
- Metadata: `scope:target` (e.g. `comment:public.users`).

### Integration DSL

- **Filter**: JSON pattern to include/exclude changes (e.g. `{ "not": { "schema": ["pg_catalog"] } }`).
- **Serialize**: Rules to customize SQL (e.g. `skipAuthorization` for schema create).

## Working with Database Objects

To add a new PostgreSQL object type:

1. Create `src/core/objects/<object-type>/` with `<object-type>.model.ts` and `<object-type>.diff.ts`.
2. Add change classes in `changes/` (create, alter, drop, comment, privilege as needed).
3. Register in `catalog.model.ts` (Catalog type + extractor).
4. Register in `catalog.diff.ts` (diff function in `diffCatalogs`).

## Conventions

- TypeScript strict; Biome for format/lint; kebab-case files with `.model.ts`, `.diff.ts`, `.test.ts`.
- SQL via `@ts-safeql/sql-tag`.

## Dependencies & Debug

- **Runtime**: `pg`, `@stricli/core`, `@ts-safeql/sql-tag`, `zod`, `debug`.
- **Debug**: `DEBUG=pg-delta:* bun run pgdelta ...`; for declarative apply, `DEBUG=pg-delta:declarative-apply` (or `DEBUG=pg-delta:*`) shows deferred statements and per-round summaries.
