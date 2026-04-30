---
"@supabase/pg-delta": patch
---

fix(pg-delta): skip rows when `pg_get_viewdef`, `pg_get_triggerdef`, `pg_get_ruledef`, or `pg_get_functiondef` returns NULL instead of crashing the relevant `extract*` with a ZodError. Same race conditions as the prior `pg_get_indexdef` (#223) and `pg_get_constraintdef` fixes — the underlying catalog row can vanish (concurrent DDL, transient catalog state, recovery edges). A single unreadable view, materialized view, trigger, rule, or function no longer aborts the whole catalog extraction and `createPlan` call.
