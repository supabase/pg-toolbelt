---
"@supabase/pg-delta": patch
---

The proof no longer fails with `relfilenode changed, no rewriteRisk declared` when a plan retypes a column of a partitioned table or a table with inheritance children. A rewrite declared on a table now also covers the partitions and children that Postgres rewrites with it.
