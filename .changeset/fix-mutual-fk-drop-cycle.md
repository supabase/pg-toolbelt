---
"@supabase/pg-delta": patch
---

fix(pg-delta): break drop-phase cycle when two tables have mutual FK references

Previously, diffing two databases where two tables each hold a foreign key
pointing at the other (and both tables are being dropped) produced a
`CycleError` because both `DropTable` changes claimed the other's FK
constraint stableId, creating bidirectional catalog edges in the drop-phase
graph. Even if the cycle had been broken at the sort layer, plain
`DROP TABLE` would have failed at apply time because PostgreSQL refuses to
drop a table while another table still has an FK pointing to it.

The diff layer now detects mutual FK references between tables dropped in
the same phase and emits explicit `ALTER TABLE ... DROP CONSTRAINT ...`
statements before the `DROP TABLE`s, producing a safe linear sequence and
no cycle in the drop-phase graph.
