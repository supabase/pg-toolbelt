---
"@supabase/pg-delta": patch
---

Fix a `dependency cycle … (guardrail 4)` planning error when a diff drops a function that takes a table's row type, and an index expression or CHECK constraint on that table calls it, while the table is dropped or replaced (for example by a partition-key change). The plan now drops the index or constraint explicitly first, then the function, then the table.
