# Effect-TS Adoption Plans

Implementation plans for adopting Effect-TS across pg-toolbelt (pg-topo and pg-delta). Each phase has a dedicated markdown file with step-by-step implementation details.

## Index

| Order | Phases | Document | Description |
|-------|--------|----------|-------------|
| 0 | Phase 0 | [00-foundation.md](./00-foundation.md) | Dependencies + tsconfig verification |
| 1 | Phase 1a–1g | [01-pg-topo-migration.md](./01-pg-topo-migration.md) | pg-topo: errors, services, parse/ingest, pipeline, from-files, validate, index |
| 2 | Phase 1h | [02-pg-topo-tests.md](./02-pg-topo-tests.md) | pg-topo test migration |
| 3 | Phase 2a–2c | [03-delta-services.md](./03-delta-services.md) | pg-delta: errors, DatabaseService, Zod → Effect Schema |
| 4 | Phase 3a–3b | [04-delta-extractors.md](./04-delta-extractors.md) | pg-delta: 28 extractors + catalog |
| 5 | Phase 3c–3f | [05-delta-pipeline.md](./05-delta-pipeline.md) | pg-delta: createPlan, applyPlan, declarative-apply, export |
| 6 | Phase 4a–4c | [06-delta-tests.md](./06-delta-tests.md) | pg-delta test infrastructure + migration |
| 7 | Phase 5a–5b | [07-delta-cli.md](./07-delta-cli.md) | pg-delta CLI: @stricli/core → @effect/cli |

## Suggested PR batching

- **PR 1:** 00-foundation
- **PR 2:** 01-pg-topo-migration
- **PR 3:** 02-pg-topo-tests
- **PR 4:** 03-delta-services
- **PR 5:** 04-delta-extractors
- **PR 6:** 05-delta-pipeline
- **PR 7:** 06-delta-tests
- **PR 8:** 07-delta-cli

## Overview

Full adoption of Effect-TS for:

- **Typed errors** — Tagged errors instead of thrown exceptions or union result types
- **Resource management** — Scope / acquireRelease for pools (no manual try/finally)
- **Dependency injection** — Services/Layers for parser, database, file system
- **Testability** — Mock layers for tests

pg-topo is migrated first as a proving ground; pg-delta follows with a custom DatabaseService wrapping the existing `pg` library (no switch to postgres.js).
