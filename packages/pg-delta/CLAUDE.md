# CLAUDE.md -- @supabase/pg-delta

## What This Package Does

PostgreSQL schema diff and migration tool. Connects to two PostgreSQL databases (source + target), extracts their catalogs, diffs them, and generates ordered DDL migration scripts.

## Commands

```bash
bun test              # All tests
bun test src/         # Unit tests only (no Docker)
bun test tests/       # Integration tests (Docker required)
bun run build         # Compile with tsc
bun run check-types   # Type check without emitting
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

## Architecture

- `src/core/` -- Core library: catalog extraction, diffing, change generation, sorting, plan creation
- `src/cli/` -- CLI entry point using @stricli/core
- `src/core/postgres-config.ts` -- pg Pool factory with custom type parsers (bigint, arrays, int2vector)
- `src/core/objects/` -- Per-object-type modules (table, function, view, etc.) with queries, diff, and change classes
- `src/core/sort/` -- Dependency-aware change sorting
- `src/core/plan/` -- Migration plan generation and SQL formatting
