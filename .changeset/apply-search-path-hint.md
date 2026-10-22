---
"@supabase/pg-delta": patch
---

When apply fails because a function or operator does not exist, the error now explains that apply runs with `search_path = pg_catalog`: schema-qualify the call, or give the routine that makes it its own `SET search_path`. A routine body that calls `gen_random_bytes()` without a schema (pgcrypto lives in `extensions` on Supabase) is the common case.
