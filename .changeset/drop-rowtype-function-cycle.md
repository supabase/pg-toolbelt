---
"@supabase/pg-delta": patch
---

Fix a `dependency cycle … (guardrail 4)` planning error when a diff drops a table together with a function that takes the table's row type, and an index expression or CHECK constraint on that table calls the function. The plan now drops the index or constraint explicitly, then the function, then the table.
