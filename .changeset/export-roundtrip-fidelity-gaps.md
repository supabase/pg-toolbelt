---
"@supabase/pg-delta": patch
---

Fix three export round-trip gaps found by the new corpus-wide export fidelity gate: a table inheriting from several parents now keeps every `INHERITS` parent when created, a partition's attached index keeps its own storage options instead of the parent index's, and a CHECK constraint that calls a function over its own table's row type is no longer folded into `CREATE TABLE` by `schema export`, which left the shadow load stuck.
