# Adopt Effect-TS Across pg-toolbelt — Master Plan

Full rewrite of pg-topo and pg-delta using Effect-TS for typed errors, resource management (Scope/acquireRelease for pools), dependency injection (Services/Layers), and improved testability. Phased approach starting with pg-topo as a proving ground.

## Sub-Plan Index

| PR   | Phases      | Document | Description                                                      |
|------|-------------|----------|------------------------------------------------------------------|
| PR 1 | Phase 0     | [00-foundation.md](./00-foundation.md) | Deps + tsconfig verification                     |
| PR 2 | Phase 1a-1g | [01-pg-topo-migration.md](./01-pg-topo-migration.md) | pg-topo full Effect migration                   |
| PR 3 | Phase 1h    | [02-pg-topo-tests.md](./02-pg-topo-tests.md) | pg-topo test migration                          |
| PR 4 | Phase 2a-2c | [03-delta-services.md](./03-delta-services.md) | pg-delta errors, DatabaseService, Zod→Schema    |
| PR 5 | Phase 3a-3b | [04-delta-extractors.md](./04-delta-extractors.md) | pg-delta 28 extractors + catalog                |
| PR 6 | Phase 3c-3f | [05-delta-pipeline.md](./05-delta-pipeline.md) | pg-delta plan, apply, declarative, export       |
| PR 7 | Phase 4a-4c | [06-delta-tests.md](./06-delta-tests.md) | pg-delta test infrastructure + migration       |
| PR 8 | Phase 5a-5b | [07-delta-cli.md](./07-delta-cli.md) | pg-delta CLI: @stricli/core → @effect/cli       |

## Design decisions

- **Keep `pg` (node-postgres):** `@effect/sql-pg` uses postgres.js. pg-delta has 28 extractors and custom type parsers; we add a custom Effect service wrapping `pg` instead of rewriting.
- **Backward compatibility:** Promise-based wrappers remain in both packages so existing consumers and tests keep working.
- **Dual exports:** Effect-native APIs (`*Effect` functions, services, layers) live alongside existing Promise APIs.
