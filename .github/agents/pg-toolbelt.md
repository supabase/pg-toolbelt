---
# Fill in the fields below to create a basic custom agent for your repository.
# The Copilot CLI can be used for local testing: https://gh.io/customagents/cli
# To make this agent available, merge this file into the default repository branch.
# For format details, see: https://gh.io/customagents/config

name: pg-toolbelt
description: Specific agent to work on pg-toolbelt issues
---

# pg-toolbelt

## Overview

Bun-based monorepo containing PostgreSQL tooling packages.

> **Note:** `AGENTS.md`, `CLAUDE.md`, and `.github/agents/pg-toolbelt.md` are all symlinks pointing to the same file. Always edit only one of them — changes will automatically reflect in all three.

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
    test(
      "test name",
      withDb(pgVersion, async (db) => {
        // db.main and db.branch are pg Pool instances
      }),
    );
  });
}
```

### pg-topo tests

Use `bun:test` with testcontainers for PostgreSQL validation. Located in `packages/pg-topo/test/`.

## Changesets

All code changes that affect package behavior must include a changeset. **When making a fix, feat, or any user-facing change (patch/minor/major), add a changeset** — do not merge or consider the work complete without one.

Use the changeset CLI to generate one:

```bash
bunx changeset
```

This will prompt you to select affected packages and choose the version bump type (`patch` for fixes, `minor` for new features, `major` for breaking changes). Commit the generated `.changeset/*.md` file alongside your code changes. Changesets automate versioning and releases on merge to main.

## Conventional Commits

All PR titles and commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) convention:

```
<type>(<scope>): <description>

# Examples
feat(pg-delta): add support for materialized views
fix(pg-topo): correct cycle detection in dependency graph
chore: update biome config
docs(pg-delta): improve README examples
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

## CI

- GitHub Actions with `dorny/paths-filter` detects which packages changed
- Only affected packages are tested
- pg-delta integration tests are sharded across 12 runners x 2 PG versions
- Changesets automate releases on merge to main

## Agent Workflow

### Plan Before Acting

Before making any code changes, present a plan describing:

- What files will be modified or created
- What the approach is
- What tests will be added or updated

Wait for user approval before implementing.

### Changesets for fix/feat/major/minor

When implementing a **fix**, **feat**, or any change that affects package behavior (patch/minor/major), add a changeset before considering the work complete. Run `bunx changeset`, select the affected package(s), pick the appropriate bump type, and commit the generated `.changeset/*.md` file with your changes.

### Testing Discipline

pg-delta has 45+ integration test files across 2 PG versions, sharded across 12 CI runners. Never run the full suite while iterating.

**During development:**

- pg-topo: `cd packages/pg-topo && bun test` is fine (small test suite)
- pg-delta unit tests: `cd packages/pg-delta && bun test src/<path-to-specific-test>.test.ts`
- pg-delta integration tests: `cd packages/pg-delta && bun test tests/integration/<specific-file>.test.ts` — one file at a time
- Run a single test within a file: `bun test --test-name-pattern "<pattern>" <file>`
- Limit PG versions to speed up iteration: `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun test tests/integration/<file>`

**Final validation only:**

- Run `bun run test:pg-delta` (full suite) only after all changes are complete and targeted tests pass

### Test Coverage Expectations

All code changes must be covered by tests:

- Unit tests go in `src/` next to the code (e.g., `src/core/objects/foo/foo.diff.test.ts`)
- Integration tests go in `tests/integration/` using `withDb`/`withDbIsolated` patterns
- **pg-delta:** Every fix or feat must be covered by at least one integration test that proves it works end-to-end (e.g. roundtrip or diff applied against a real DB).
- Follow existing test patterns in the codebase

### Snapshot Assertions

Prefer `toMatchInlineSnapshot` over `toBe` or `toEqual` when asserting SQL output in integration tests. Inline snapshots make the expected SQL immediately visible in the test file, improving readability and making regressions obvious at a glance.

```typescript
expect(result.sql).toMatchInlineSnapshot(`
  "ALTER TABLE foo ADD COLUMN bar integer;"
`);
```

Run tests once to auto-generate the snapshot values — Bun will fill them in automatically on first run. Starts with empty assertions (eg: expect(statements).toMatchInlineSnapshots(``) ) then update snapshots intentionally with `bun run test -u -- <test-name>`
