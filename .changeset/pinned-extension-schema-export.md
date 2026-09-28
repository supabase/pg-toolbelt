---
"@supabase/pg-delta": patch
---

`CREATE EXTENSION` no longer carries a `SCHEMA <s>` clause when the extension's control file pins `<s>` (pgmq → `pgmq`, pg_tle → `pgtle`) and the target already holds `<s>`, possibly only as an assumed platform schema: Postgres finds or creates the pinned schema itself. This fixes Supabase-profile `schema export` output that failed to replay into a fresh database with `schema "pgmq" does not exist` (supabase/cli#6728). A schema the plan creates keeps the clause. The pin is extracted from the default version's control file as non-hashed `_controlSchema` metadata, and plan-target projection now keeps reference-only marks when a delta is filtered.
