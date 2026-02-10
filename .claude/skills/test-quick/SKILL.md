---
name: test-quick
description: Run all tests quickly with PostgreSQL 17 only (fastest feedback loop). Use when asked to run tests, verify tests pass, or check if code works.
---

# Quick Test Run

Run all unit and integration tests with PostgreSQL 17 only for fast feedback (2-5 minutes instead of 10+ minutes with both PG versions).

## Quick Test

```bash
pnpm run test:quick
```

This runs:
1. All unit tests (109 test files, ~400 tests)
2. All integration tests with PostgreSQL 17 only

## Why PostgreSQL 17 Only?

By default, integration tests run against **both** PostgreSQL 15 and 17, which doubles test time. For development, testing against one version is usually sufficient:

- PG 17 is the latest version
- Most SQL features are compatible across versions
- CI will still test both versions
- Saves ~5-10 minutes per test run

## Running Both PostgreSQL Versions

If you need to test both versions:

```bash
# Unit tests (no PG dependency)
pnpm run test:unit:run

# Integration with PG 15
pnpm run test:integration:pg15

# Integration with PG 17
pnpm run test:integration:pg17

# All tests with both PG versions (slow - like CI)
pnpm run test:unit:run && pnpm test:integration:run
```

## Watch Mode for Development

```bash
# Unit tests in watch mode
pnpm run test:unit

# Integration tests with PG 17 in watch mode
pnpm run test:integration:pg17:watch
```

## Coverage

```bash
# Unit tests with coverage
pnpm run test:unit:coverage

# Integration tests with coverage (slower)
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test --project=integration --coverage
```

## Notes

- Unit tests are fast (~3 seconds)
- Integration tests use Testcontainers (require Docker)
- First integration test run pulls Docker images (slower)
- Integration tests run with maxWorkers=1 to share containers
- Use `test:quick` for iterative development
- CI tests both PG versions in parallel with 12 shards per version
