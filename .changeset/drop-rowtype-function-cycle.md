---
"@supabase/pg-delta": patch
---

Fix `dependency cycle … (guardrail 4)` planning errors when a dropped table's index expression, CHECK constraint or column domain calls a function that depends on the table (for example one taking the table's row type), and the function is dropped or rebuilt with it. The plan now drops the index, constraint or column explicitly first, then the function, then the table. Dropping an index or constraint (including a foreign key) from a table that the plan replaces, for example after a partition-key change, no longer cycles either.
