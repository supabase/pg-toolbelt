---
"@supabase/pg-delta": patch
---

fix(pg-delta): order RLS policies after referenced new objects

Policies whose `USING` / `WITH CHECK` expression references another new object could be emitted before the referenced object on a fresh database, causing plan/apply to fail.

`extractRlsPolicies` now joins `pg_depend` to surface every relation (tables, partitioned tables, views, materialized views, foreign tables) and function the policy expression references. PostgreSQL already records those edges at `CREATE POLICY` time via `recordDependencyOnExpr`, so the catalog is authoritative and pg-delta's core diffing path does not reparse the expression text. `CreateRlsPolicy.requires` dispatches per relation kind and emits `stableId.procedure(...)` for functions, using the exact argument signature produced by `format_type(proargtypes)` — matching the signature embedded in the procedure extractor's stable id.

Sequences referenced via `nextval('seq'::regclass)` remain a known gap (tracked as a skipped regression test) because `pg_depend` only records the edge for `regclass` literal arguments.
