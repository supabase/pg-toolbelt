# CLAUDE.md -- @supabase/pg-topo

## What This Package Does

Topological sorting for SQL DDL statements. Reads `.sql` files, parses them, extracts object dependencies, and returns statements in a valid execution order.

## Commands

```bash
bun test                    # All tests (Docker required for validation)
bun run build               # Bundle with bun + emit declarations with tsc
bun run check-types         # Type check without emitting
bun run format-and-lint     # Biome check
```

## Architecture

7-stage pipeline: Discover -> Parse -> Classify -> Extract -> Build Graph -> Topo Sort -> Result

- `src/ingest/` -- SQL file discovery and parsing (plpgsql-parser)
- `src/classify/` -- Statement classification (38 types)
- `src/extract/` -- Dependency extraction from AST
- `src/graph/` -- Graph building and topological sort (Kahn's algorithm)
- `src/annotations/` -- SQL comment annotation parsing (`-- pg-topo:` directives)
- `src/model/` -- Core types and ObjectRef identity

## Test Patterns

Tests use `bun:test` with testcontainers for PostgreSQL runtime validation:
- `test/global-setup.ts` -- Preloaded to pull Docker images
- `test/support/postgres/postgres-container.ts` -- Container lifecycle using Bun's native SQL class
- Tests create temporary fixture directories with SQL files

## Key API

```typescript
import { analyzeAndSort } from "@supabase/pg-topo";
const { ordered, diagnostics, graph } = await analyzeAndSort({ roots: ["./sql/"] });
```
