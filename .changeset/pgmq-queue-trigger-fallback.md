---
"@supabase/pg-delta": patch
---

fix(pg-delta): suppress user triggers on pgmq queue/archive tables in supabase integration

Follow-up to the Wasm FDW dependents fix. `pgmq.q_<name>` and `pgmq.a_<name>` are materialized lazily by `select pgmq.create('<name>')`, not by `CREATE EXTENSION pgmq`. The trigger extractor already drops these via the `pg_depend deptype='e'` row that pgmq records, but real-world cloud projects can lose that row (older pgmq versions — pgmq `1.4.4` which Supabase Cloud currently ships never records it — manual `pg_dump`/restore that strips extension deps, etc.), so `supabase db reset` aborts at the trigger statement with `relation "pgmq.q_<name>" does not exist`. Add a defensive name-match fallback in the supabase integration filter so the trigger is dropped even when the principled signal is missing.
