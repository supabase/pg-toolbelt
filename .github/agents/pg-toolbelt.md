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

> **Note:** `.github/agents/pg-toolbelt.md` is the canonical file. `AGENTS.md` and `CLAUDE.md` are symlinks pointing to it. Always edit the canonical file — changes will automatically reflect in all three.

## Packages

- **packages/pg-delta** (`@supabase/pg-delta`): PostgreSQL schema diff and migration tool. Compares two live databases and generates DDL migration scripts.
- **packages/pg-topo** (`@supabase/pg-topo`): Topological sorting for SQL DDL statements. Pure library that accepts SQL content strings, extracts dependencies, and produces a deterministic execution order. Includes an optional filesystem adapter for discovering/reading `.sql` files.

## Quick Reference

> **Important:** Always use `bun run test`, never bare `bun test`. The `test` script in `package.json` includes required flags.

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
cd packages/pg-delta && bun run test src/     # Unit tests only
cd packages/pg-delta && bun run test tests/   # Integration tests (Docker required)
cd packages/pg-topo && bun run test           # All tests (Docker required)

# Test against a specific PostgreSQL version
PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run test tests/
```

## Architecture

- Both packages are runtime-agnostic: importable in Bun, Node.js, or Deno
- Conditional exports: `bun` condition serves TypeScript source directly, `import` serves compiled JS
- `pg-delta` uses the `pg` npm library for database connections (works in Bun via Node.js compat)
- `pg-topo` is pure static analysis — no runtime database dependency in the library itself
- Integration tests use `testcontainers` to spin up PostgreSQL Docker containers
- Biome handles formatting and linting (config at root `biome.json`)
- Changesets manage versioning across both packages

### Serialize Options

When adding or changing a serialize option in `pg-delta`, keep the typing and ownership split consistent:

- Define the shared serializer option fields in `packages/pg-delta/src/core/integrations/serialize/serialize.types.ts`. This file is the single source of truth for `SerializeOptions`.
- If an option is only relevant to one change family, derive a local alias from the shared type in `serialize.types.ts` with `Pick<...>` (for example `SchemaSerializeOptions` or `ExtensionSerializeOptions`) instead of creating a new standalone options type.
- Do not define a separate local `SerializeOptions` type in `packages/pg-delta/src/core/integrations/serialize/dsl.ts`. The DSL should import the shared type and pass it through.
- `packages/pg-delta/src/core/objects/base.change.ts` should expose `serialize(options?: SerializeOptions)`.
- Concrete change classes under `packages/pg-delta/src/core/objects/**/changes/*.ts` must accept either the shared `SerializeOptions` or a derived alias, even when the option is unused. Use `_options?: SerializeOptions` for unused parameters so the full `Change` union accepts `change.serialize(rule.options)`.
- Keep product-specific serialization behavior in integrations such as `packages/pg-delta/src/core/integrations/supabase.ts` unless the behavior is truly generic for all users. Integration-specific rules belong in the serialize DSL before they belong in core change logic.
- Do not redesign the global serializer options as a union of per-change option types unless the serialize DSL itself is also being redesigned to tie `when` clauses to specific change subtypes. With the current free-form `FilterPattern`, one shared global contract is the intended model.

When adding a new serialize option, update tests at the same time:

- Add or update focused coverage in `packages/pg-delta/src/core/integrations/serialize/dsl.test.ts`.
- Add or update the relevant object serializer test next to the concrete change class (for example `extension.create.test.ts`).
- If the behavior is user-facing, update one existing end-to-end regression or add one targeted integration test. Prefer reusing an existing regression over creating duplicate integration coverage.

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

```text
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
- pg-delta integration tests are sharded across 15 runners x 3 PG versions
- Changesets automate releases on merge to main

When changing shard count or PG versions, update all of these locations:

- `.github/workflows/tests.yml` — `shard_index`, `shard_total` in the matrix
- `scripts/coverage.ts` — default `--shards` value (doc comment + code)
- This file (`AGENTS.md` / `CLAUDE.md`) — both the CI section and the Testing Discipline section

## Agent Workflow

### Plan Before Acting

Before making any code changes, present a plan describing:

- What files will be modified or created
- What the approach is
- What tests will be added or updated

Wait for user approval before implementing.

### Changesets for fix/feat/major/minor

When implementing a **fix**, **feat**, or any change that affects package behavior (patch/minor/major), add a changeset before considering the work complete. Run `bunx changeset`, select the affected package(s), pick the appropriate bump type, and commit the generated `.changeset/*.md` file with your changes.

### Test-Driven Fixes

Every bug fix must land as two commits (or one clearly described TDD history in the commit body):

1. **Red.** Add a test that reproduces the bug and fails against the current code. Run the focused command and paste the failure output into the commit body so reviewers can see the regression shape.
2. **Green.** Apply the minimum code change that makes the red test pass. Do not touch unrelated code in the same commit.

A fix without a failing test first is not complete. If the bug genuinely cannot be reproduced in a test (e.g. a race, a user-environment-only issue), say so explicitly in the PR and explain what manual verification was performed instead.

This rule applies to every `fix(...)` and to any `feat(...)` that changes existing behavior. New `feat(...)` work follows the usual coverage expectations in the _Test Coverage Expectations_ section.

### Testing Discipline

pg-delta has 45+ integration test files across 3 PG versions, sharded across 15 CI runners. Never run the full suite while iterating.

**During development:**

- pg-topo: `cd packages/pg-topo && bun run test` is fine (small test suite)
- pg-delta unit tests: `cd packages/pg-delta && bun run test src/<path-to-specific-test>.test.ts`
- pg-delta integration tests: `cd packages/pg-delta && bun run test tests/integration/<specific-file>.test.ts` — one file at a time
- Run a single test within a file: `bun run test --test-name-pattern "<pattern>" <file>`
- Limit PG versions to speed up iteration: `PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run test tests/integration/<file>`

**Final validation only:**

- Run `bun run test:pg-delta` (full suite) only after all changes are complete and targeted tests pass

### Upgrading Supabase test images

When changing `packages/pg-delta/tests/constants.ts`, especially
`POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG`, treat the generated Supabase
baseline fixtures as part of the upgrade.

- Do **not** hand-edit `packages/pg-delta/tests/integration/fixtures/supabase-base-init/*.sql`.
  Regenerate them with the maintainer script.
- Regenerate all supported fixtures:
  `cd packages/pg-delta && env -u PGDELTA_TEST_POSTGRES_VERSIONS bun run sync-base-images`
- Regenerate a single version while iterating:
  `cd packages/pg-delta && PGDELTA_TEST_POSTGRES_VERSIONS=17 bun run sync-base-images`
- The sync script is expected to:
  - create a temporary `supabase start` project pinned to the exact image tag
  - diff a bare `supabase/postgres` container against the fully bootstrapped
    local stack
  - write `tests/integration/fixtures/supabase-base-init/<major>_fullstack_container_init.sql`
  - replay that SQL into a fresh test-style Supabase container and require a
    final zero-diff validation
- `withDbSupabaseIsolated(...)` automatically replays the generated base-init
  fixture. Any test that starts `SupabasePostgreSqlContainer` manually must call
  `applySupabaseBaseInit(...)` from `packages/pg-delta/tests/utils.ts` before
  asserting on Supabase-managed objects or applying project migrations.
- After upgrading the image tags, rerun the focused regression tests before
  considering the upgrade done:
  - `cd packages/pg-delta && PGDELTA_TEST_POSTGRES_VERSIONS=15,17 bun run test tests/integration/supabase-base-init.test.ts tests/integration/catalog-model.test.ts tests/integration/supabase-dsl-e2e.test.ts`
  - `cd packages/pg-delta && PGDELTA_TEST_POSTGRES_VERSIONS=15 bun run test tests/integration/dbdev-roundtrip.test.ts`
- If the sync script or focused tests reveal new schemas, roles, grants, or
  comments, update pg-delta’s Supabase handling (for example
  `packages/pg-delta/src/core/integrations/supabase.ts` or the relevant
  extraction/diff/serialization logic) instead of papering over the problem by
  editing the generated SQL fixture by hand.

### Test Coverage Expectations

All code changes must be covered by tests:

- Unit tests go in `src/` next to the code (e.g., `src/core/objects/foo/foo.diff.test.ts`)
- Integration tests go in `tests/integration/` using `withDb`/`withDbIsolated` patterns
- **pg-delta:** Every fix or feat must be covered by at least one integration test that proves it works end-to-end (e.g. roundtrip or diff applied against a real DB).
- Prefer `roundtripFidelityTest` for pg-delta integration coverage instead of hand-rolled `createPlan` + apply assertions. Use custom plan assertions only when validating planner internals that roundtrip utilities cannot express.
- Follow existing test patterns in the codebase

### Snapshot Assertions

Prefer `toMatchInlineSnapshot` over `toBe` or `toEqual` when asserting SQL output in integration tests. Inline snapshots make the expected SQL immediately visible in the test file, improving readability and making regressions obvious at a glance.

```typescript
expect(result.sql).toMatchInlineSnapshot(`
  "ALTER TABLE foo ADD COLUMN bar integer;"
`);
```

Start with an empty inline snapshot assertion, run the test once so Bun fills in the expected value automatically, and update snapshots intentionally with `bun run test -u -- "pattern"`.

### Kaizen (Continuous Improvement)

Whenever you are told you made a mistake — whether in commands, coding style, or guidelines — extract a generalizable lesson and propose a change to these agent guidelines so the same mistake does not happen again.

### Common Issues

- Lint errors can usually be detected and auto-fixed by running `bun run format-and-lint --write --unsafe && bun run check-types && bun run knip --fix`. Run this after you finish code changes to ensure you don't introduce lint errors into the project.
