---
"@supabase/pg-delta": major
"@supabase/pg-topo": major
---

Refactor `@supabase/pg-delta` and `@supabase/pg-topo` around explicit
Effect-native and Promise-based entrypoints.

For both packages, the package root and `./effect` entrypoints now export the
canonical Effect API. Promise wrappers now live behind the explicit `./node`
and `./bun` entrypoints.

As part of that split:

- the root `@supabase/pg-delta` entrypoint is now Effect-native instead of
  re-exporting Promise wrappers
- `@supabase/pg-topo` now exposes explicit `./effect`, `./node`, and `./bun`
  entrypoints aligned with `pg-delta`
- public `*Effect` export duplicates were removed in favor of unsuffixed
  Effect-native exports from the root and `./effect` entrypoints
