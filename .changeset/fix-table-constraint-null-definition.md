---
"@supabase/pg-delta": patch
---

fix(pg-delta): skip table constraints where `pg_get_constraintdef()` returns NULL instead of crashing `extractTables` with a ZodError. Like `pg_get_indexdef`, `pg_get_constraintdef` can return NULL under race conditions with concurrent DDL or transient catalog inconsistencies. Such constraints are now filtered out at extraction time so a single unreadable constraint no longer aborts the whole catalog extraction and `createPlan` call.
