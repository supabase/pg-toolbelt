# CLAUDE.md -- @supabase/pg-delta

## What This Package Does

PostgreSQL schema diff and migration tool. Connects to two PostgreSQL databases (source + target), extracts their catalogs, diffs them, and generates ordered DDL migration scripts. Safety-first: detects data-loss operations and supports a plan-based workflow for preview and version control.

## Commands

```bash
bun test              # All tests (unit + integration)
bun test src/         # Unit tests only (no Docker)
bun test tests/       # Integration tests (Docker required)
bun run build         # Compile with tsc
bun run check-types   # Type check without emitting
bun run pgdelta       # Run CLI (e.g. bun run pgdelta plan --help)
```

## Test Patterns

### Unit tests (`src/**/*.test.ts`)

```typescript
import { describe, expect, test } from "bun:test";
```

No database needed. Test change classes, diff logic, SQL formatting.

### Integration tests (`tests/**/*.test.ts`)

```typescript
import { describe, test } from "bun:test";
import { withDb, withDbIsolated } from "../utils.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`feature (pg${pgVersion})`, () => {
    // Fast: shared container, database-level isolation
    test(
      "test name",
      withDb(pgVersion, async (db) => {
        // db.main, db.branch are pg Pool instances
      }),
    );

    // Slow: fresh containers per test, full isolation
    test(
      "isolated test",
      withDbIsolated(pgVersion, async (db) => {
        // db.main, db.branch are pg Pool instances
      }),
    );
  });
}
```

### Key files

- `tests/utils.ts` -- `withDb`, `withDbIsolated`, `withDbSupabaseIsolated` wrappers
- `tests/container-manager.ts` -- Singleton container pool management
- `tests/integration/roundtrip.ts` -- Core roundtrip fidelity test helper
- `tests/constants.ts` -- PostgreSQL version config (reads `PGDELTA_TEST_POSTGRES_VERSIONS` env)
- `tests/global-setup.ts` -- Preload for integration test container lifecycle

## Architecture

### Core (`src/core/`)

- **Catalog**: `catalog.model.ts`, `catalog.diff.ts` — extract and diff catalogs; each object type has an extractor and diff.
- **postgres-config.ts** — pg Pool factory with custom type parsers (bigint, arrays, int2vector).
- **objects/** — Per-object-type modules (table, function, view, role, etc.):
  - `<type>.model.ts` — Types and catalog extraction.
  - `<type>.diff.ts` — Diff logic.
  - `changes/` — create, alter, drop, comment, privilege; each implements `serialize()` and `depends`.
- **sort/** — Dependency-aware change sorting (two-phase: DROP then CREATE/ALTER; topological + logical grouping).
- **plan/** — Migration plan generation and SQL formatting (`create.ts`, `apply.ts`, `risk.ts`, `sql-format/`).
- **integrations/** — Filter and serialization DSL; `filter/dsl.ts`, `serialize/dsl.ts`, `supabase.ts`.

### CLI (`src/cli/`)

- `bin/cli.ts` — Entry point.
- `app.ts` — Stricli CLI framework.
- `commands/` — plan, apply, sync, declarative-export, declarative-apply, etc.
- `formatters/` — Tree view, SQL scripts.
- `utils.ts` — Shared CLI helpers.

### Cycle Breaking / Normalization

Keep cycle handling split by the scope of information it needs:

- **Object-local PostgreSQL semantics stay in `diff*`**. If a single object diff can prove a statement is redundant or invalid on its own, fix it there. Example: `src/core/objects/sequence/sequence.diff.ts` skips `DROP SEQUENCE` when `OWNED BY` means PostgreSQL will already cascade-drop it with the owning table/column.
- **Deterministic whole-plan rewrites belong in post-diff normalization**. If the final `Change[]` itself should be rewritten before dependency sorting, implement it in `src/core/post-diff-normalization.ts` (`normalizePostDiffChanges`), wired from `src/core/catalog.diff.ts` after raw diffs and `expandReplaceDependencies()`. The pass is the single chokepoint that observes the final `Change[]`, so it catches cross-object effects regardless of whether the relevant change pair was emitted by an object's `diff*` (e.g. `index.diff` for a definition-changed index) or by `expandReplaceDependencies()` (dependency-closure replacement). Current examples: pruning same-table `AlterTableDropColumn` / `AlterTableDropConstraint` changes superseded by an expansion-added `DropTable+CreateTable` pair, deduplicating constraint Add/Validate/Comment on replaced tables, and re-emitting `ALTER TABLE … REPLICA IDENTITY USING INDEX` after a replica-identity index is dropped+recreated.
- **Unbreakable graph cycles belong in sort-phase change injection**. If the emitted statements are valid but topological sorting discovers a hard dependency cycle that cannot be solved by weak-edge filtering, implement the narrow pattern in `src/core/sort/cycle-breakers.ts` (`tryBreakCycleByChangeInjection`). Existing examples: injecting explicit FK constraint drops for dropped-table FK cycles and rebuilding `AlterTableDropColumn` for publication-column cycles on surviving tables.
- **`expandReplaceDependencies()` only computes replacement closure**. It may report metadata such as which tables were promoted to replacement pairs, but it should not own unrelated cycle-pruning policy.
- **`src/core/sort/dependency-filter.ts` is a narrow last resort**. Use it only for safe edge filtering where the emitted statements are already valid and only the graph edge is artificial. Do not extend sort-phase filtering to paper over plans that would still fail at apply time.

Rule of thumb: if the fix changes a valid final `Change[]` before graph construction, it is post-diff; if it reacts to a concrete unbreakable dependency cycle and needs to inject or rebuild changes, it belongs in the sort-phase cycle breakers; if it needs only one object's semantics, it belongs in that object's `diff*`; if it only removes a graph edge without changing emitted SQL, it belongs in the sort filter.

## Key Concepts

### Change object structure

Every change has: **type**, **operation** (create/alter/drop), **scope** (object/comment/privilege/membership), **properties**, **serialize()**, and **depends** (array of stable identifiers).

### Stable identifiers

Used to track objects across databases (OIDs differ per environment):

- Schema objects: `type:schema.name` (e.g. `table:public.users`).
- Sub-entities: `type:schema.parent.name` (e.g. `column:public.users.email`).
- Metadata: `scope:target` (e.g. `comment:public.users`).

**Always build stable identifiers through the `stableId.*` helpers in
`src/core/objects/utils.ts` (or the `<Object>.stableId` getter on a model
instance) — never inline the prefix as a template literal.** Inline strings
like `` `index:${schema}.${table}.${name}` `` drift from the helper if
prefixes or escaping rules change, scatter the format across the codebase,
and were caught in review on this exact pattern. If you need a stable id
for an object type that does not have a helper yet, add the helper to
`stableId` first, then use it everywhere — including new code paths,
post-diff passes, and dependency wiring inside change classes.

When asserting stable ids in tests, the literal form is fine as the
expected value (it documents the on-the-wire format), but the **production
side** of the comparison should still call the helper.

### Integration DSL

- **Filter**: JSON pattern to include/exclude changes (e.g. `{ "not": { "schema": ["pg_catalog"] } }`).
- **Serialize**: Rules to customize SQL (e.g. `skipAuthorization` for schema create).

## Working with Database Objects

To add a new PostgreSQL object type:

1. Create `src/core/objects/<object-type>/` with `<object-type>.model.ts` and `<object-type>.diff.ts`.
2. Add change classes in `changes/` (create, alter, drop, comment, privilege as needed).
3. Register in `catalog.model.ts` (Catalog type + extractor).
4. Register in `catalog.diff.ts` (diff function in `diffCatalogs`).

### Physical attnums vs logical names

Never place raw PostgreSQL attnums (`pg_trigger.tgattr`, `pg_index.indkey`, `pg_constraint.conkey`/`confkey`, `pg_publication_rel.prattrs`, etc.) inside a model's `dataFields()` or `NON_ALTERABLE_FIELDS`. Attnums are **physical** and diverge between logically-identical tables whose column layouts were built differently (`CREATE TABLE` vs `ALTER TABLE DROP/ADD COLUMN`) — dropped columns leave "dead" attnums that are never renumbered, so every subsequent diff would emit a spurious replace and never converge. Compare either:

- the authoritative `pg_get_<obj>def()` output (see `Index` and `Trigger`), or
- column **names** resolved via `pg_attribute` at extraction time (see `Table.conkey`/`confkey`, `Publication.prattrs`).

Storing the raw attnum array purely for debugging/introspection is fine — just keep it out of equality.

## Conventions

- TypeScript strict; oxfmt + oxlint for format/lint; kebab-case files with `.model.ts`, `.diff.ts`, `.test.ts`.
- SQL via `@ts-safeql/sql-tag`.

## Dependencies & Debug

- **Runtime**: `pg`, `@stricli/core`, `@ts-safeql/sql-tag`, `zod`, `debug`.
- **Debug**: `DEBUG=pg-delta:* bun run pgdelta ...`; for declarative apply, `DEBUG=pg-delta:declarative-apply` (or `DEBUG=pg-delta:*`) shows deferred statements and per-round summaries.
