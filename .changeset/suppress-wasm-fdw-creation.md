---
"@supabase/pg-delta": patch
---

fix(pg-delta): suppress CREATE/DROP/ALTER FOREIGN DATA WRAPPER for platform-managed Wasm wrappers in the supabase integration

The `supabase` integration now skips any FDW whose `HANDLER` or `VALIDATOR` references a function in the `extensions` schema. This covers the Wasm-based wrappers (`clerk`, `clerk_oauth`, etc.) that Supabase Cloud provisions as `supabase_admin` at project creation. `CREATE FOREIGN DATA WRAPPER` requires superuser, and the local Docker image has no equivalent pre-step, so the previous diff output broke `supabase db reset`. Owner-based filtering wasn't enough because the wrapper owner is often rewritten away from `supabase_admin` after a dump/restore.
