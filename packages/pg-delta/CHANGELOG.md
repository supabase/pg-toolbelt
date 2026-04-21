# @supabase/pg-delta

## 1.0.0-alpha.17

### Patch Changes

- 5cc2a21: fix(pg-delta): stop emitting spurious `CREATE OR REPLACE TRIGGER` on logically-identical triggers whose underlying tables have different physical column layouts.

  The trigger diff was comparing `pg_trigger.tgattr` (raw physical attnums) as part of its non-alterable fields. When the same logical trigger (e.g. `BEFORE UPDATE OF col_a, col_b ...`) existed on two tables with different physical column layouts — one built via a single `CREATE TABLE`, the other grown via `ALTER TABLE DROP/ADD COLUMN` (which leaves "dead" attnums that are never renumbered) — the attnum vectors diverged while the trigger definition (rendered by `pg_get_triggerdef()` using column names) was byte-identical. The diff kept firing a `ReplaceTrigger` every round, and because `CREATE OR REPLACE TRIGGER` does not renumber the table's physical columns, the loop never converged.

  Triggers are now compared by `pg_get_triggerdef()` output (column names) instead of raw `tgattr` attnums, matching the existing `Index` pattern that handles the same class of bug for `indkey`.

## 1.0.0-alpha.16

### Patch Changes

- a0f6f11: fix(pg-delta): strip brackets from IPv6 hosts before handing them to pg so `getaddrinfo` sees a bare address.

  The alpha.14 IPv6 fix normalized percent-encoded hosts into the canonical bracketed URL form (`postgresql://user@[2600:...]:5432/db`). That is a valid URL, but `pg-connection-string`'s WHATWG-based parser keeps the brackets on `config.host`, so `pg` passed `[2600:...]` verbatim to `getaddrinfo` and connections failed with `ENOTFOUND [2600:...]`.

  `createManagedPool` now expands bracketed-IPv6 URLs into explicit `host` / `port` / `user` / `password` / `database` pool fields (plus any remaining query params like `application_name`) and drops `connectionString` on that path — `pg` merges a parsed `connectionString` on top of user config, so a co-provided `host` would otherwise be clobbered. Non-IPv6 URLs still go through `connectionString` unchanged.

## 1.0.0-alpha.15

### Patch Changes

- 82be5f4: fix(pg-delta): break drop-phase cycles for owned-sequence column drops and replace-dependency table recreates

  Two previously unbreakable drop-phase `CycleError`s are now fixed at the
  source by eliding redundant changes instead of patching the sort-phase
  cycle filter.

  - `diffSequences` now skips `DROP SEQUENCE` when the owning column is
    dropped on a surviving table (e.g. dropping a `SERIAL` column).
    PostgreSQL's `OWNED BY` cascade already drops the sequence with the
    column, so emitting `DROP SEQUENCE` both failed at apply time and formed
    an unbreakable cycle with `AlterTableDropColumn`. This mirrors the
    existing short-circuit for whole-table drops.
  - `expandReplaceDependencies` now removes pre-existing
    `AlterTableDropColumn(T.col)` and `AlterTableDropConstraint(T.c)` changes
    when it enqueues a `DropTable(T) + CreateTable(T)` replacement pair for
    the same table. Those are the only `AlterTable*` subclasses whose
    `requires` includes `table.stableId`, producing a `column:T.col → table:T`
    (or `constraint:T.c → table:T`) explicit edge that closed an unbreakable
    drop-phase cycle against catalog `constraint → column → table` edges.
    Supersession is scoped to those two classes only; other `AlterTable*(T)`
    changes (owner, RLS toggles, replica identity, storage params,
    SET LOGGED/UNLOGGED) and privilege-scope ALTERs (GRANT/REVOKE) are
    preserved so the recreated table ends up in the correct state — the sort
    phase orders them after `CreateTable(T)` via their `table.stableId`
    requirement.

- 82be5f4: fix(pg-delta): break drop-phase cycle when two tables have mutual FK references

  Previously, diffing two databases where two tables each hold a foreign key
  pointing at the other (and both tables are being dropped) produced a
  `CycleError` because both `DropTable` changes claimed the other's FK
  constraint stableId, creating bidirectional catalog edges in the drop-phase
  graph. Even if the cycle had been broken at the sort layer, plain
  `DROP TABLE` would have failed at apply time because PostgreSQL refuses to
  drop a table while another table still has an FK pointing to it.

  The diff layer now detects mutual FK references between tables dropped in
  the same phase and emits explicit `ALTER TABLE ... DROP CONSTRAINT ...`
  statements before the `DROP TABLE`s, producing a safe linear sequence and
  no cycle in the drop-phase graph.

## 1.0.0-alpha.14

### Patch Changes

- 13e94b9: fix(pg-delta): auto-normalize percent-encoded IPv6 hosts in connection URLs and retry transient connect failures.

  Connection strings with URL-encoded IPv6 hosts (e.g. `postgresql://user:pass@2406%3Ada18%3A...%3Ab3c9:5432/db`) are now transparently rewritten to the canonical bracketed form (`[2406:da18:...:b3c9]`) before reaching `pg`, preventing `getaddrinfo ENOTFOUND` failures on the percent-encoded string. The decoded host is validated as a real IPv6 literal; anything else is passed through unchanged so downstream errors remain honest.

  `createManagedPool` also retries its eager-connect probe with bounded exponential backoff on transient errors (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, and its own timeout wrapper). Auth failures (`28P01`, `28000`), TLS negotiation errors, and `ENOTFOUND` still fail fast. Tunable via `PGDELTA_CONNECT_MAX_ATTEMPTS` (default 3), `PGDELTA_CONNECT_BASE_BACKOFF_MS` (default 250), and `PGDELTA_CONNECT_MAX_BACKOFF_MS` (default 1000).

- f2420d9: Improve procedure comment diffing, PostgreSQL 17 generated column handling, and Supabase "etl" schema filtering

## 1.0.0-alpha.13

### Patch Changes

- 5b8511b: fix(export): allow declarative schema export to accept raw integration DSL without requiring callers to precompile serialize rules

## 1.0.0-alpha.12

### Patch Changes

- b9c7ebe: fix(pg-delta): support serial and identity transition diffs for table columns
- d15eb48: fix(sort): order FK-related table drops and publication table removals before dependent destructive operations
- e065101: Fix Supabase declarative export for `pgmq` by allowing the integration serializer to omit `WITH SCHEMA` during extension creation, so exported schemas can be applied to a fresh database. Formalize serializer option typing with a shared `SerializeOptions` contract so integration DSL options and change serializers stay in sync.

## 1.0.0-alpha.11

### Patch Changes

- 8048cd9: Fix view diffs to drop and recreate views when the projected column list changes (for example when `SELECT *` views need to pick up a new base-table column), instead of emitting `CREATE OR REPLACE VIEW`.
- bb63513: fix(depend): order CREATE EXTENSION before CREATE INDEX when index uses extension-provided operator class
- 066683e: fix(pg-delta): order domain CHECK function dependencies before domain creation
- f2cd63e: Use normalized object snapshots when comparing extracted catalog objects for equality so semantically identical metadata does not produce false-positive diffs.

## 1.0.0-alpha.10

### Patch Changes

- 72dce37: Support PostgreSQL 18 table introspection for NOT NULL constraints and add pg18 test coverage.

## 1.0.0-alpha.9

### Patch Changes

- 505413e: Fix async pool session setup so declarative export no longer triggers concurrent `client.query()` deprecation warnings during catalog extraction.
- def35a5: Rename the declarative apply CLI flag for skipping final function validation to `--skip-function-validation`.

## 1.0.0-alpha.8

### Patch Changes

- d6c9f90: fix(plan): use catalog-shape guard instead of instanceof Catalog so deserialized catalogs work in edge/bundled runtimes (declarative sync)

## 1.0.0-alpha.7

### Minor Changes

- 28f6a9b: fix: export createManagedPool from lib core

## 1.0.0-alpha.6

### Patch Changes

- 7acf51b: fix(package): replace workspace protocol for pg-topo runtime dependency so npm releases resolve in Deno

## 1.0.0-alpha.5

### Minor Changes

- 2441e1c: Add `@supabase/pg-delta/catalog-export` subpath export for programmatic catalog export (extract, serialize, deserialize, createManagedPool) without pulling in the full package API.
- 646e6be: Fix duplicate role creation from different grantors
- f7de56c: fix correct order for grant/revoke
- bf47b8b: fix some invalid postgres syntax in serialize
- 2441e1c: feat: add declarative export/apply and catalog-export to pg-delta

### Patch Changes

- 9c445f1: fix(roles): skip self-granted memberships to avoid ADMIN option error on PG 17+
- Updated dependencies [2441e1c]
  - @supabase/pg-topo@1.0.0-alpha.1

## 1.0.0-alpha.4

### Minor Changes

- c267747: feat: add basic formatter to sql output

### Patch Changes

- 4f8faf3: fix(formatter): issue with EVENT TRIGGER clause
- 1dacd2a: Handle constraint triggers in table introspection and trigger updates

## 1.0.0-alpha.3

### Patch Changes

- bbf13d3: fix: add 'supabase_superuser' to roles filter
- f4b10f7: add cli_login_postgres to system roles

## 1.0.0-alpha.2

### Patch Changes

- c20112a: Fix sslmode=require connections to SSL-enforced databases
- 323f751: Fix support for using a different role after a connection is established. Migrate to "pg" for finer control over the connections.

## 1.0.0-alpha.1

### Major Changes

- f8614f1: Rework the public API exports

## 1.0.0-alpha.0

### Major Changes

- 88bdff0: Release alpha
