---
"@supabase/pg-delta": patch
---

Fix ZodError when extracting tables with EXCLUDE constraints defined over expressions. PostgreSQL stores `attnum=0` in `pg_constraint.conkey` for expression elements, which never matches `pg_attribute`, so the inner aggregate returned SQL `NULL` and tripped `tablePropsSchema` at `constraints[*].key_columns`. The extractor now coalesces the aggregate to an empty JSON array.
