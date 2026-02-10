# Claude Code Skills for pg-delta

This directory contains Claude Code skills to improve developer experience.

## Available Skills

### `ci-check`
Run all CI quality checks (TypeScript, Biome, Knip) in parallel.

**When to use**: Before committing, creating PRs, or when asked to "check code quality"

**Command**: `pnpm run ci:check`

### `test-quick`
Run all tests with PostgreSQL 17 only (fastest feedback loop).

**When to use**: During development, iterating on features, when asked to "run tests"

**Command**: `pnpm run test:quick`

### `test-file`
Run specific test file(s) by path or pattern.

**When to use**: Testing one feature, debugging specific tests, focused development

**Examples**:
- `pnpm test table` - All tests matching "table"
- `PGDELTA_TEST_POSTGRES_VERSIONS=17 pnpm test tests/integration/table-operations.test.ts`

### `test-unit`
Run only unit tests (fast, no Docker required).

**When to use**: Working on diff logic, quick iteration, no Docker available

**Command**: `pnpm run test:unit:run`

### `test-integration`
Run integration tests with real PostgreSQL.

**When to use**: Testing database operations, verifying migrations, end-to-end testing

**Commands**:
- `pnpm run test:integration:pg17` - PG 17 only (recommended)
- `pnpm run test:integration:run` - Both PG versions

### `format-fix`
Auto-fix formatting and linting issues.

**When to use**: Before committing, after making changes, fixing lint errors

**Command**: `pnpm run format`

## Quick Reference

```bash
# Most common workflows
pnpm run test:quick           # Test everything (fast)
pnpm run ci:check             # Check quality
pnpm run format               # Fix formatting

# Specific test scenarios
pnpm run test:unit:run        # Unit tests only
pnpm run test:integration:pg17 # Integration tests only

# Watch mode development
pnpm run test:unit            # Watch unit tests
pnpm run test:integration:pg17:watch # Watch integration tests
```

## Environment Variables

- `PGDELTA_TEST_POSTGRES_VERSIONS`: Control which PostgreSQL versions to test
  - `17` - Only PostgreSQL 17 (fast, recommended for dev)
  - `15` - Only PostgreSQL 15
  - `15,17` - Both versions (default, slow)

## CI vs Local

**Local Development**: Use single PG version for speed
```bash
pnpm run test:quick  # Uses PG 17 only
```

**CI**: Tests both PG versions with 12 shards per version
```bash
# CI automatically tests both 15 and 17
```

## Tips

1. Always use `PGDELTA_TEST_POSTGRES_VERSIONS=17` for integration tests locally
2. Run `pnpm run ci:check` before pushing
3. Use watch mode for iterative development
4. Docker must be running for integration tests
5. First integration test run is slower (pulls images)

## All Available Scripts

### Quality Checks
- `pnpm run ci:check` - Run all checks in parallel
- `pnpm run ci:check:types` - TypeScript only
- `pnpm run ci:check:lint` - Biome only
- `pnpm run ci:check:knip` - Knip only
- `pnpm run format` - Auto-fix formatting
- `pnpm run format:unsafe` - Auto-fix (unsafe)

### Unit Tests
- `pnpm run test:unit` - Watch mode
- `pnpm run test:unit:run` - Run once
- `pnpm run test:unit:coverage` - With coverage

### Integration Tests
- `pnpm run test:integration` - Watch mode (both PG versions)
- `pnpm run test:integration:run` - Run once (both PG versions)
- `pnpm run test:integration:pg15` - PG 15 only
- `pnpm run test:integration:pg17` - PG 17 only
- `pnpm run test:integration:pg15:watch` - Watch PG 15
- `pnpm run test:integration:pg17:watch` - Watch PG 17

### Combined
- `pnpm run test:quick` - Fast: unit + integration (PG 17)
- `pnpm run test:all` - Full: ci:check + test:quick

## Using Skills with Claude

You can use natural language commands with Claude:

- "run all quality checks" → triggers `ci-check` skill
- "run the tests" → triggers `test-quick` skill
- "test the table operations file" → triggers `test-file` skill
- "fix the formatting" → triggers `format-fix` skill
- "run unit tests" → triggers `test-unit` skill
- "run integration tests" → triggers `test-integration` skill

Skills are automatically discovered based on trigger words in your requests.
