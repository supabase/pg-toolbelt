---
"@supabase/pg-delta": patch
---

fix(pg-delta): keep a UNIQUE that matches a PK or another UNIQUE as ALTER TABLE

Postgres silently drops a UNIQUE inlined in CREATE TABLE when its column list
equals a PRIMARY KEY or another UNIQUE in the same statement
(`transformIndexConstraints`). Compaction now leaves those UNIQUEs as
`ALTER TABLE … ADD CONSTRAINT` so one apply pass converges.
