---
"@supabase/pg-delta": patch
---

Keep a table's declared column order when a plan creates it, or when it is exported and reloaded, if a column is generated or waits on a same-schema type. Before, such a column was added after the columns declared behind it, so `SELECT *`, positional `INSERT` and `COPY` without a column list saw a different order. Two cases still put a column after the columns declared behind it: a column whose `DEFAULT` calls a user function (Postgres runs the function when the column is added, and it may read a later column), and a generated column declared before a column it reads.
