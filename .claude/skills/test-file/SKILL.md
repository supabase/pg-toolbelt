---
name: test-file
description: Run one or more specific test files by path or pattern. Use when asked to test a specific file, test one feature, or run a subset of tests.
---

# Run Specific Test Files

Run one or more test files by path or pattern.

## Run a Single File

```bash
# Unit test file
pnpm test src/core/objects/table/table.diff.test.ts

# Integration test file with PG 17 only (faster)
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts

# Integration test file with both PG versions
pnpm test tests/integration/table-operations.test.ts
```

## Run Multiple Files by Pattern

```bash
# All table-related tests
pnpm test table

# All tests in a directory
pnpm test tests/integration/

# All aggregate tests
pnpm test aggregate

# Multiple patterns (run unit tests only)
pnpm test --project=unit src/core/objects/table/
```

## Run by Test Name

```bash
# Run tests matching a name pattern
pnpm test -t "table with constraints"

# Run tests in specific file matching name
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts -t "constraints"
```

## Watch Mode

```bash
# Watch a specific file
pnpm test src/core/objects/table/table.diff.test.ts --watch

# Watch integration tests with PG 17
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts --watch
```

## Project-Specific Testing

```bash
# Only unit tests matching pattern
pnpm test --project=unit table

# Only integration tests matching pattern
PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test --project=integration table
```

## Understanding Test Types

**Unit Tests** (`src/**/*.test.ts`, excluding `*.integration.test.ts`):
- 109 test files throughout src/ directory
- Fast (run in parallel with full thread pool)
- No Docker/PostgreSQL required
- Test individual functions and diffing logic

**Integration Tests** (`tests/integration/**/*.test.ts` and `**/*.integration.test.ts`):
- 35+ test files in tests/integration/
- Slower (use Testcontainers with real PostgreSQL)
- Run with maxWorkers=1 to share containers
- Test end-to-end roundtrip fidelity
- Test against PG 15 and 17 by default

## Tips

- Always use `PGDELTA_TEST_POSTGRES_VERSIONS=17` for integration tests during development
- Vitest filters files by path pattern (case-insensitive substring match)
- Use `--project=unit` or `--project=integration` to scope tests
- The first integration test run pulls Docker images (one-time delay)
- Watch mode is great for iterative development
- Use `-t` for test name filtering within files
