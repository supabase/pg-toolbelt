---
name: test-integration
description: Run integration tests with real PostgreSQL (requires Docker). Use when testing end-to-end behavior, database operations, or verifying migrations work correctly.
---

# Integration Tests

Run integration tests with real PostgreSQL databases using Testcontainers. These test end-to-end migration generation and application.

## Prerequisites

- **Docker must be running** (integration tests use Testcontainers)
- First run pulls Docker images (postgres:15.14-alpine and postgres:17.6-alpine)

## Quick Start (Single PG Version)

```bash
# Run with PostgreSQL 17 only (recommended for development)
pnpm run test:integration:pg17

# Watch mode for iterative development
pnpm run test:integration:pg17:watch

# Run with PostgreSQL 15
pnpm run test:integration:pg15
```

## Run All Integration Tests (Both PG Versions)

```bash
# Run once (like CI, but no sharding)
pnpm run test:integration:run

# Watch mode (not recommended - slow with both versions)
pnpm run test:integration
```

## Run Specific Integration Tests

```bash
# Specific file with PG 17
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts

# By pattern with PG 17
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test --project=integration table

# Specific file with both PG versions
pnpm test --project=integration tests/integration/table-operations.test.ts
```

## What Integration Tests Cover

Integration tests are in `tests/integration/` (35+ files):

- **Roundtrip fidelity**: Create objects in branch, generate migration, apply to main, verify diff is empty
- **Real PostgreSQL behavior**: Constraints, indexes, triggers, RLS policies, etc.
- **Cross-version compatibility**: Test against PG 15 and PG 17
- **Dependency ordering**: Complex dependencies between objects
- **Edge cases**: Circular dependencies, default privileges, partitioned tables
- **Operations**: Create, alter, drop, rename for all object types

## PostgreSQL Version Control

By default, integration tests run against **both** PostgreSQL 15 and 17:

```bash
# Controlled by environment variable
PGDELTA_TEST_POSTGRES_VERSIONS=17      # Only PG 17 (fast)
PGDELTA_TEST_POSTGRES_VERSIONS=15      # Only PG 15
PGDELTA_TEST_POSTGRES_VERSIONS=15,17   # Both (default)
```

## Performance

- **With one PG version**: ~2-3 minutes
- **With both PG versions**: ~5-10 minutes (each test runs twice)
- Integration tests use `maxWorkers=1` to share container instances
- First run pulls Docker images (one-time delay)
- Containers are reused across tests in same run

## CI Behavior

CI runs integration tests with:
- Both PostgreSQL versions (15 and 17)
- 12 shards per version (24 total jobs)
- Parallel execution for speed
- Separate jobs for each PG version validation

## Tips

- Use `test:integration:pg17` for development (much faster)
- Use watch mode for iterative integration test development
- Full PG version testing happens in CI - no need locally
- Integration tests validate what unit tests cannot (real DB behavior)
- Each test uses isolated databases (no pollution between tests)
- Docker must be running before executing integration tests

## Coverage

```bash
# Integration tests with coverage (slow)
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test --project=integration --coverage
```

## Debugging Integration Tests

```bash
# Run with DEBUG env var for verbose output
DEBUG=pg-delta:* PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts

# Run single test by name
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts -t "simple table with columns"

# Watch mode for debugging specific test
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts -t "constraints" --watch
```
