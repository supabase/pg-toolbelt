---
"@supabase/pg-delta": patch
---

fix(pg-delta): skip indexes where `pg_get_indexdef()` returns NULL instead of crashing `extractIndexes` with a ZodError. The three-argument form of `pg_get_indexdef` can return NULL under race conditions with concurrent DDL (e.g. the index being dropped mid-extraction) or when catalog metadata is transiently inconsistent. Such indexes are now filtered out with a debug log (`DEBUG=pg-delta:extract:index`) so a single unreadable index no longer aborts the whole catalog extraction and `createPlan` call.
