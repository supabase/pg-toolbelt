# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@supabase/pg-delta` is a TypeScript library and CLI that generates PostgreSQL migration scripts by comparing two databases. It extracts catalog metadata from a "source" (current) and "branch" (target) database, diffs them, and produces safe, ordered SQL migration statements.

## Commands

```bash
# Install dependencies
pnpm install

# Build (TypeScript → dist/)
pnpm run build

# Quality checks (run before committing)
pnpm run ci:check          # types + lint + knip in sequence
pnpm run format             # auto-fix formatting (Biome)

# Testing - fastest feedback loop
pnpm run test:quick         # unit + integration (PG 17 only)
pnpm run test:unit:run      # unit tests only (no Docker)

# Run a specific test file
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm vitest run tests/integration/table-operations.test.ts

# Integration tests by PG version
pnpm run test:integration:pg17
pnpm run test:integration:pg15

# Watch modes
pnpm run test:unit                      # watch unit tests
pnpm run test:integration:pg17:watch    # watch integration (PG 17)
```

Docker must be running for integration tests. First run is slower due to image pulls.

## Architecture

### Core Pipeline

The migration generation follows this pipeline:

1. **Extract** — `catalog.model.ts`: Queries `pg_catalog` and `pg_depend` from both databases, producing `Catalog` objects representing full schema state
2. **Diff** — `catalog.diff.ts`: Compares two Catalogs, delegates to per-object-type diff modules, returns an unordered `Change[]`
3. **Sort** — `sort/`: Two-phase topological sort using `pg_depend` data + explicit constraints. Phase 1: DROP operations (reverse dependency order). Phase 2: CREATE/ALTER operations (forward dependency order)
4. **Risk** — `plan/risk.ts`: Classifies changes as `"safe"` or `"data_loss"`
5. **Serialize** — Each `Change` has a `.serialize()` method producing SQL. Integration DSL can customize output
6. **Plan** — `plan/create.ts`: Bundles statements + fingerprints + filters into a JSON-serializable `Plan`
7. **Apply** — `plan/apply.ts`: Executes plan SQL, verifies fingerprints match post-migration

### Key Source Directories

- `src/core/objects/` — 26 PostgreSQL object types (table, index, view, function, trigger, type, role, schema, etc.). Each has `.diff.ts`, `.types.ts`, and a `changes/` directory with create/alter/drop Change classes
- `src/core/sort/` — Dependency graph construction, topological sort, cycle detection, custom ordering constraints
- `src/core/plan/` — Plan creation, application, serialization, risk assessment, fingerprinting
- `src/core/integrations/` — Filter and serialization DSL for customizing which changes are included and how SQL is generated. `supabase.ts` is the built-in Supabase integration
- `src/cli/` — CLI built with `@stricli/core`. Commands: `plan`, `apply`, `sync`

### Public API

Exported from `src/index.ts`: `createPlan`, `applyPlan`, and types (`Plan`, `CreatePlanOptions`, `IntegrationDSL`). Supabase integration exported from `./integrations/supabase`.

### Testing Patterns

Integration tests use **TestContainers** to spin up PostgreSQL instances. The core test helper is `roundtripFidelityTest` in `tests/integration/roundtrip.ts`, which:
1. Sets up initial schema in both databases
2. Applies test SQL to the branch database only
3. Generates a migration plan (source → branch)
4. Applies the plan to the source database
5. Verifies the source now matches the branch (fingerprint + re-diff)

Test fixtures use `getTest(version)` from `tests/utils.ts` which provides `db.main` and `db.branch` Pool instances via Vitest fixtures. Tests are parameterized over PostgreSQL versions using `PGDELTA_TEST_POSTGRES_VERSIONS` env var.

Unit tests live alongside source in `src/**/*.test.ts`. Integration tests live in `tests/integration/`.

## Tooling

- **Biome** for formatting and linting (not ESLint/Prettier). Double quotes, 2-space indent
- **Knip** for unused code detection
- **Changesets** for versioning
- **Vitest** with workspace projects: `unit` (threaded parallelism) and `integration` (single worker, concurrent sequences)
- **pnpm** as package manager

## Environment Variables

- `PGDELTA_TEST_POSTGRES_VERSIONS` — `15`, `17`, or `15,17` (default). Controls which PG versions integration tests run against
- `DEBUG=pg-delta:*` — Enable debug logging

