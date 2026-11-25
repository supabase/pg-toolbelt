---
"@supabase/pg-topo": patch
---

Treat a `create … if not exists` statement repeated across files (for example `create schema if not exists app;` at the top of each file) as one object instead of reporting `DUPLICATE_PRODUCER`. Statements that use the object are ordered after every copy. A plain `create` next to an `if not exists` one, or two `if not exists` statements that differ, still report the duplicate.
