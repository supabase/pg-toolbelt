---
"@supabase/pg-delta": patch
---

Recreate partitions, views, and publication membership across a parent-table replace, and emit child indexes plus `ALTER INDEX … ATTACH PARTITION` so partitioned-index attach-state converges.
