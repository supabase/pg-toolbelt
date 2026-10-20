---
"@supabase/pg-delta": patch
---

Keep a table's declared column order when a plan creates it, or when it is exported and reloaded, if a column is generated or waits on a function or a same-schema type. A generated column declared before a column it reads still comes after that column, because pg-delta adds them in separate steps. Before, such a column was added after the columns declared behind it, so `SELECT *`, positional `INSERT` and `COPY` without a column list saw a different order.
