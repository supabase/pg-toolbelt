# @supabase/pg-delta

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
