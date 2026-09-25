---
"@supabase/pg-delta": patch
---

`CREATE EXTENSION` no longer carries a `SCHEMA <s>` clause when the extension's control file pins `<s>` (pgmq → `pgmq`, pg_tle → `pgtle`): Postgres finds or creates the pinned schema itself. This fixes Supabase-profile `schema export` output that failed to replay into a fresh database with `schema "pgmq" does not exist` (supabase/cli#6728), because the platform-assumed schema is never exported. The pinned schema is extracted as non-hashed `_controlSchema` metadata, only when the installed and default extension versions agree on it.
