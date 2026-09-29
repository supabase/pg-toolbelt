---
"@supabase/pg-delta": patch
---

Stop `plan` / `diff` from printing spurious `dangling_edge` warnings for partitioned and inherited tables. Objects PostgreSQL materializes from a parent (inherited columns, cloned partition constraints and FK clones, copied defaults, cloned triggers) and identity sequences are never facts: dependencies on them now resolve to the modeled parent/owner, and their own dependencies (which mirror the owner's) are no longer emitted. A view, FK or index over a partition now also depends on that partition, so changing a partition's bound rebuilds them instead of failing with "cannot drop table … because other objects depend on it".
