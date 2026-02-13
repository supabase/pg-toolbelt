# CLAUDE.md -- pg-toolbelt

## Overview

Bun-based monorepo containing PostgreSQL tooling packages.

## Packages

- **packages/pg-delta** (`@supabase/pg-delta`): PostgreSQL schema diff and migration tool. Compares two live databases and generates DDL migration scripts.
- **packages/pg-topo** (`@supabase/pg-topo`): Topological sorting for SQL DDL statements. Pure library that accepts SQL content strings, extracts dependencies, and produces a deterministic execution order. Includes an optional filesystem adapter for discovering/reading `.sql` files.

## Quick Reference

```bash
# Install all dependencies
bun install

# Build all packages
bun run build

# Test all packages
bun run test

# Test specific package
bun run test:pg-delta
bun run test:pg-topo

# Type check all
bun run check-types

# Lint and format all
bun run format-and-lint

# Run a single package's tests directly
cd packages/pg-delta && bun test src/     # Unit tests only
cd packages/pg-delta && bun test tests/   # Integration tests (Docker required)
cd packages/pg-topo && bun test           # All tests (Docker required)

# Test against a specific PostgreSQL version
PGDELTA_TEST_POSTGRES_VERSIONS=17 bun test tests/
```

## Architecture

- Both packages are runtime-agnostic: importable in Bun, Node.js, or Deno
- Conditional exports: `bun` condition serves TypeScript source directly, `import` serves compiled JS
- `pg-delta` uses the `pg` npm library for database connections (works in Bun via Node.js compat)
- `pg-topo` is pure static analysis -- no runtime database dependency in the library itself
- Integration tests use `testcontainers` to spin up PostgreSQL Docker containers
- Biome handles formatting and linting (config at root `biome.json`)
- Changesets manage versioning across both packages

## Test Patterns

### pg-delta unit tests
Standard `describe`/`test`/`expect` from `bun:test`. No database needed. Located in `packages/pg-delta/src/**/*.test.ts`.

### pg-delta integration tests
Use `withDb(pgVersion, callback)` / `withDbIsolated(pgVersion, callback)` wrapper from `tests/utils.ts`. Located in `packages/pg-delta/tests/**/*.test.ts`.

```typescript
import { describe, test } from "bun:test";
import { withDb } from "../utils.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`my feature (pg${pgVersion})`, () => {
    test("test name", withDb(pgVersion, async (db) => {
      // db.main and db.branch are pg Pool instances
    }));
  });
}
```

### pg-topo tests
Use `bun:test` with testcontainers for PostgreSQL validation. Located in `packages/pg-topo/test/`.

## CI

- GitHub Actions with `dorny/paths-filter` detects which packages changed
- Only affected packages are tested
- pg-delta integration tests are sharded across 12 runners x 2 PG versions
- Changesets automate releases on merge to main
