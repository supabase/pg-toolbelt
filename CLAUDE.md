# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

pg-delta is a PostgreSQL migration tool that generates safe migration scripts by comparing two databases. It detects schema differences, creates dependency-ordered SQL, and provides a plan-based workflow for reviewing changes before applying them.

**Key Features:**
- Database diff with automatic migration generation
- Safety-first: detects data-loss operations and requires confirmation
- Plan-based workflow: preview, version control, and reproduce migrations
- Integration DSL: JSON-based filtering and serialization rules
- Supports all PostgreSQL object types (30+ object types)

## Development Commands

```bash
# Build
pnpm build                    # Compile TypeScript to dist/

# Testing
pnpm test                     # Run all tests (unit + integration)
vitest --project unit         # Unit tests only (fast, no Docker)
vitest --project integration  # Integration tests (requires Docker)
vitest src/path/to/file.test.ts  # Run single test file

# Linting & Formatting
pnpm format-and-lint          # Check formatting and linting
pnpm format-and-lint --write  # Auto-fix issues
pnpm check-types              # Type checking without emit

# Code Quality
pnpm knip                     # Find unused exports/dependencies

# CLI Development (without building)
pnpm pgdelta <command>        # Run CLI via ts-node (for development)

# After building, test the CLI
./dist/cli/bin/cli.js <command>  # Or use: pgdelta (if installed globally)
```

## Testing Strategy

The project uses Vitest with two distinct test configurations:

**Unit Tests** (`src/**/*.test.ts`, excluding `*.integration.test.ts`)
- Run in parallel with full concurrency
- No external dependencies (databases, Docker)
- Fast feedback loop for logic testing

**Integration Tests** (`tests/integration/**/*.test.ts` or `*.integration.test.ts`)
- Run with maxWorkers=1 to share Docker containers
- Requires Docker (uses testcontainers)
- Tests against real PostgreSQL databases
- Global setup: `tests/global-setup.ts` manages container lifecycle
- Timeout: 60 seconds per test

When writing tests:
- Unit tests go in `src/` next to the code they test
- Integration tests go in `tests/integration/` or use `*.integration.test.ts` suffix
- Integration tests reuse containers managed by `tests/container-manager.ts`

## Architecture

### Core System (`src/core/`)

**Catalog System** (`catalog.model.ts`, `catalog.diff.ts`)
- Extracts PostgreSQL catalog metadata into structured objects
- Diffs two catalogs to produce a list of changes
- Each object type has its own extractor (e.g., `extractTables`, `extractRoles`)

**Object Types** (`src/core/objects/`)
- 30+ PostgreSQL object types, each with its own directory
- Structure: `<object-type>/<object-type>.model.ts`, `<object-type>.diff.ts`
- Changes: `changes/<object-type>.create.ts`, `.alter.ts`, `.drop.ts`, `.comment.ts`, `.privilege.ts`
- Each change type implements SQL serialization and dependency tracking

**Dependency System** (`depend.ts`, `expand-replace-dependencies.ts`)
- Tracks three types of dependencies:
  1. **Catalog dependencies**: From `pg_depend` table
  2. **Explicit dependencies**: Declared in object definitions (e.g., column types)
  3. **Logical dependencies**: Business rules (e.g., default privileges before table creation)
- Expands dependencies for REPLACE operations (e.g., replacing a view recreates its indexes)

**Sorting Engine** (`src/core/sort/`)
- Two-phase sorting: DROP phase (reverse deps) → CREATE/ALTER phase (forward deps)
- Logical grouping for readability (e.g., group table with its indexes)
- Handles circular dependencies by breaking deferrable constraints
- Files:
  - `sort-changes.ts`: Main entry point
  - `topological-sort.ts`: Dependency-based ordering
  - `logical-sort.ts`: Readability grouping
  - `graph-builder.ts`: Builds dependency graph
  - `custom-constraints.ts`: Business logic dependencies

**Plan System** (`src/core/plan/`)
- `create.ts`: Generates plans (diff → filter → serialize → sort)
- `apply.ts`: Executes plans with safety checks
- `risk.ts`: Classifies changes by risk (data loss detection)
- `hierarchy.ts`: Formats changes as a tree for CLI display
- Plans are JSON files containing changes, metadata, and DSL rules

**Integration DSL** (`src/core/integrations/`)
- `filter/dsl.ts`: Pattern matching to include/exclude changes
- `serialize/dsl.ts`: Customize SQL generation (e.g., skip authorization)
- `integration-dsl.ts`: Combined filter + serialization rules
- `supabase.ts`: Built-in integration for Supabase databases

### CLI System (`src/cli/`)

- `bin/cli.ts`: Entry point
- `app.ts`: Stricli CLI framework configuration
- `commands/`: Three commands: `plan`, `apply`, `sync`
- `formatters/`: Output formatters (tree view, SQL scripts)
- `utils.ts`: Common CLI utilities

## Key Concepts

### Change Object Structure

Every change has:
- **type**: Object type (e.g., `"table"`, `"schema"`, `"role"`)
- **operation**: `"create"`, `"alter"`, or `"drop"`
- **scope**: `"object"`, `"comment"`, `"privilege"`, or `"membership"`
- **properties**: Object-specific data (e.g., table name, schema)
- **serialize()**: Generates SQL statements
- **depends**: Array of stable identifiers this change depends on

### Stable Identifiers

Used to track objects across databases (OIDs are environment-specific):
- Schema objects: `type:schema.name` (e.g., `table:public.users`)
- Sub-entities: `type:schema.parent.name` (e.g., `column:public.users.email`)
- Metadata: `scope:target` (e.g., `comment:public.users`)

### Integration DSL

Filter DSL example:
```json
{
  "not": {
    "schema": ["pg_catalog", "information_schema"]
  }
}
```

Serialize DSL example:
```json
[
  {
    "when": { "type": "schema", "operation": "create" },
    "options": { "skipAuthorization": true }
  }
]
```

## Code Conventions

- **TypeScript**: Strict mode enabled
- **Formatting**: Biome (indent: 2 spaces, double quotes)
- **Imports**: Organized automatically by Biome
- **File naming**: kebab-case with type suffixes (`.model.ts`, `.diff.ts`, `.test.ts`)
- **Test naming**: Descriptive test names using Vitest's `describe`/`it`
- **SQL**: Uses `@ts-safeql/sql-tag` for type-safe SQL queries

## Working with Database Objects

When adding support for a new PostgreSQL object type:

1. **Create object directory** in `src/core/objects/<object-type>/`
2. **Model** (`<object-type>.model.ts`): Define type + extractor function
3. **Diff** (`<object-type>.diff.ts`): Implement diff logic
4. **Changes** (`changes/` directory):
   - `<object-type>.base.ts`: Base change class
   - `<object-type>.create.ts`: CREATE operations
   - `<object-type>.alter.ts`: ALTER operations
   - `<object-type>.drop.ts`: DROP operations
   - `<object-type>.comment.ts`: COMMENT operations (if applicable)
   - `<object-type>.privilege.ts`: GRANT/REVOKE operations (if applicable)
5. **Register** in `catalog.model.ts`: Add to `Catalog` interface and `extractCatalog`
6. **Register** in `catalog.diff.ts`: Add diff function to `diffCatalogs`

## Release Process

- Uses Changesets for version management
- Conventional commits enforced via PR linting
- On merge to main: Changesets creates a release PR
- When release PR is merged: Automatic npm publish via GitHub Actions
- Currently in alpha: `1.0.0-alpha.x`

## Dependencies

**Runtime:**
- `pg`: PostgreSQL client
- `@stricli/core`: CLI framework
- `@ts-safeql/sql-tag`: Type-safe SQL
- `zod`: Schema validation
- `debug`: Debug logging (use `DEBUG=pg-delta:* pnpm pgdelta ...`). For declarative apply, `DEBUG=pg-delta:declarative-apply` (or `DEBUG=pg-delta:*`) shows which statements are deferred, why they were deferred, and per-round summaries.

**Development:**
- `vitest`: Testing framework
- `testcontainers`: Docker-based integration tests
- `@biomejs/biome`: Linting and formatting
- `@changesets/cli`: Version management
- `knip`: Unused code detection

## Environment

- **Node.js**: >=20.0.0
- **Package manager**: pnpm 10.26.1
- **Docker**: Required for integration tests
