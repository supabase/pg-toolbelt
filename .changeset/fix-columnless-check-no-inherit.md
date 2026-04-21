---
"@supabase/pg-delta": patch
---

fix(pg-delta): preserve column-less CHECK NO INHERIT constraints on inherited tables

Normalize empty `conkey` values to an empty `key_columns` array when extracting
table CHECK constraints. This preserves column-less `CHECK (FALSE) NO INHERIT`
constraints on inheritance parents during diff and replay, so inherited-table
schemas keep their insert-blocking semantics after roundtrips.
