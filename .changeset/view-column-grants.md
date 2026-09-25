---
"@supabase/pg-delta": patch
---

Extract and plan column-level grants on views and materialized views (e.g. `GRANT INSERT (name) ON api.items TO authenticated`). They were previously dropped from exports and invisible to diffs.
