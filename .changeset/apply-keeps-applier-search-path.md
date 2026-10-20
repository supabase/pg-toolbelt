---
"@supabase/pg-delta": patch
---

`apply` (and the `--dry-run` apply script) now runs with `pg_catalog` followed by the applier's own `search_path`, instead of `pg_catalog` alone. The DDL is fully qualified, but expressions it evaluates — a column default on `ADD COLUMN`, an index or CHECK over a user function — resolve unqualified names inside routine bodies through the session path, so e.g. a default calling a function that uses pgcrypto from Supabase's `extensions` schema failed with `function gen_random_bytes(integer) does not exist`. Keeping `pg_catalog` first means built-ins are never shadowed by a user schema the role lists earlier.
