---
"@supabase/pg-delta": patch
---

Renaming an inheritance parent or a partitioned table now keeps its children and partitions with their rows. Before, each was dropped and recreated, since it named the parent by its old name. A child's check merged with the parent's is now renamed by the parent's `RENAME CONSTRAINT`, with no rename or prompt of its own; before, planning failed with a `dependency cycle` or the apply was refused. A parent with an index, or a child renamed in the same plan, is still recreated.
