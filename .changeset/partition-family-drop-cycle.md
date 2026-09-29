---
"@supabase/pg-delta": patch
---

Fix a `topoSort` dependency cycle when dropping a partitioned table together with its partitions while the parent carries an index: attached child indexes now fold into their own partition's `DROP TABLE` instead of the parent index's drop root.
