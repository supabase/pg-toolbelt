# pg-topo

_deterministic dependency sorting for declarative PostgreSQL schemas_

`pg-topo` sorts declarative PostgreSQL schema statements into a deterministic, dependency-safe execution order.

It is designed for SQL-first projects where schema lives in many `.sql` files and statement order is not guaranteed.

## Why

In declarative schema repos, statements are often split by concern (tables, functions, policies, grants, etc.).  
Execution order then becomes fragile:

- function created before a referenced function
- view created before a base table
- FK/constraint/index ordering issues
- policy/trigger statements applied before targets exist

`pg-topo` performs static analysis over SQL ASTs, builds a dependency graph, and returns the sorted order plus diagnostics.

## Current Scope

- Library API only (no CLI yet)
- Static analysis only in publishable library code
- Deterministic output for the same input set
- Runtime validation is test-support code in this repository (not part of public API)

## Installation

When published:

```bash
bun add pg-topo
```

For local development in this repo:

```bash
bun install
```

## Quick Start

```ts
import { analyzeAndSort } from "pg-topo";

const result = await analyzeAndSort({
  roots: ["./schema"], // files and/or directories
});

if (result.diagnostics.length > 0) {
  for (const diagnostic of result.diagnostics) {
    console.log(`[${diagnostic.code}] ${diagnostic.message}`);
  }
}

const sortedSql = result.ordered.map((statement) => statement.sql).join("\n\n");
await Bun.write("./dist/sorted-schema.sql", `${sortedSql}\n`);
```

## Public API

`analyzeAndSort(options)` is exported from the package entrypoint (`src/index.ts` in this repo).

```ts
type AnalyzeOptions = {
  roots: string[];
};

type AnalyzeResult = {
  ordered: StatementNode[];
  diagnostics: Diagnostic[];
  graph: GraphReport;
};
```

Additional exported types:

- `AnnotationHints`
- `DiagnosticCode`
- `GraphEdge`
- `GraphEdgeReason`
- `ObjectKind`
- `ObjectRef`
- `PhaseTag`
- `StatementId`

### `ordered`

`ordered` is the topologically sorted statement list.  
Each item includes:

- original `sql`
- `statementClass`
- `phase`
- extracted `provides` / `requires`
- stable `id` (`filePath`, `statementIndex`)

### `diagnostics`

Static diagnostics emitted by the library:

- `PARSE_ERROR`
- `DISCOVERY_ERROR`
- `UNKNOWN_STATEMENT_CLASS`
- `UNRESOLVED_DEPENDENCY`
- `DUPLICATE_PRODUCER`
- `CYCLE_DETECTED`
- `INVALID_ANNOTATION`

### `graph`

Graph metadata includes:

- `nodeCount`
- `edges` (`from`, `to`, `reason`, optional `objectRef`)
- `cycleGroups`

## Input Discovery Rules

Given `roots`, `pg-topo`:

- accepts `.sql` files directly
- recursively scans directories for `.sql` files
- sorts discovered files deterministically
- emits `DISCOVERY_ERROR` for missing roots

## Deterministic Ordering

Ordering combines:

1. dependency graph edges (`requires` -> `provides`)
2. phase ordering (`bootstrap`, `pre_data`, `data_structures`, `routines`, `post_data`, `privileges`)
3. statement-class priority tie-breaks (pg_dump-inspired)
4. stable source tie-breakers (file path + statement index)

## Annotations

You can provide explicit hints with leading SQL comments:

```sql
-- pg-topo:phase routines
-- pg-topo:depends_on app.users
-- pg-topo:requires function:app.normalize(jsonb)
-- pg-topo:provides view:app.user_ids
create view app.user_ids as
select id from app.users;
```

Supported directives:

- `phase`
- `depends_on`
- `requires`
- `provides`

Notes:

- only _leading_ comment lines are parsed as annotations
- invalid or conflicting annotations produce `INVALID_ANNOTATION` diagnostics
- annotation directive prefix is `pg-topo:`

## What It Does Not Do

- It does not execute SQL as part of library API.
- It does not infer every extension-provided object statically.
- It does not solve fundamentally ambiguous runtime-only cases (for example deeply dynamic SQL).

## Quality Checks and Tests

```bash
bun run --parallel "*:check"
bun run --parallel "*:fix"
bun run test
```

Individual scripts from `package.json`:

- `test`
- `types:check`
- `lint:check`
- `lint:fix`
- `fmt:check`
- `fmt:fix`
- `knip:check`
- `knip:fix`

This repo includes test-support runtime validation against live PostgreSQL containers (Testcontainers) to verify sorted output execution in integration fixtures.
