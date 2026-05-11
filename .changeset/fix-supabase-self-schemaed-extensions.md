---
"@supabase/pg-delta": patch
---

fix(pg-delta): skip `WITH SCHEMA` when serializing `pgsodium` and `pg_tle` under the Supabase integration

Both extensions create their install schema (`pgsodium`, `pgtle`) themselves, and those schemas are filtered out of the declarative plan by the Supabase integration because they live in `SUPABASE_SYSTEM_SCHEMAS`. Emitting `CREATE EXTENSION pgsodium WITH SCHEMA pgsodium` (or the equivalent for `pg_tle`) therefore fails against a fresh database with `schema "pgsodium" does not exist` — the same bug shape PR #191 fixed for `pgmq`.

Closes supabase/pg-toolbelt#222.
