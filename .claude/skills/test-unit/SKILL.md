---
name: test-unit
description: Run only unit tests (fast, no Docker required). Use when working on core logic, diffing algorithms, or when asked to test without integration tests.
---

# Unit Tests

Run only unit tests (109 test files, ~400 tests). These are fast and don't require Docker or PostgreSQL.

## Run All Unit Tests

```bash
# Run once
pnpm run test:unit:run

# Watch mode for development
pnpm run test:unit

# With coverage
pnpm run test:unit:coverage
```

## Run Specific Unit Tests

```bash
# By path pattern
pnpm test --project=unit table

# By directory
pnpm test --project=unit src/core/objects/table/

# Specific file
pnpm test --project=unit src/core/objects/table/table.diff.test.ts

# By test name
pnpm test --project=unit -t "add column"
```

## What Unit Tests Cover

Unit tests are located in `src/**/*.test.ts` (excluding `*.integration.test.ts`):

- **Object diffing** (table.diff.test.ts, schema.diff.test.ts, etc.)
- **Change generation** (table.alter.test.ts, table.create.test.ts, etc.)
- **SQL serialization** (how changes convert to SQL statements)
- **Model validation** (Zod schemas, type checking)
- **Filter and serialization DSL** (integration rules)

## Speed

- **Fast**: ~3 seconds for all 400 tests
- Run in parallel with full thread pool
- No Docker, no PostgreSQL, no network
- Ideal for TDD and quick iteration

## When to Use Unit Tests Only

- Working on diff logic or change detection
- Testing SQL generation without database
- Refactoring models or types
- Running tests in environments without Docker
- Quick smoke test during development

## When to Also Run Integration Tests

Unit tests verify logic in isolation, but integration tests verify:
- Round-trip fidelity (apply migrations and diff back to empty)
- Real PostgreSQL behavior
- Cross-version compatibility (PG 15 vs 17)
- Dependency ordering and constraints
- Edge cases with real database state

After unit tests pass, run integration tests with:
```bash
pnpm run test:integration:pg17
```

Or use the quick test command:
```bash
pnpm run test:quick
```
