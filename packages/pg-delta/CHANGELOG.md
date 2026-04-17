# @supabase/pg-delta

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
