---
"@supabase/pg-delta": patch
---

Dropping a role no longer drops and recreates the tables, views, and functions it owns: a surviving object moves to its desired owner with `ALTER … OWNER TO`, so its rows are kept.
