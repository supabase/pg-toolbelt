---
"@supabase/pg-delta": patch
---

A renamed table, domain, or foreign table now renames its constraints in the same plan (`t1_pkey` to `t2_pkey`), so one apply converges. Before, the next plan renamed them, or dropped and re-added them (rebuilding a primary key, revalidating a check) when a check was respelled or the rename was accepted in prompt mode. A constraint on a foreign table is now renamed with `ALTER TABLE`, since Postgres rejects `ALTER FOREIGN TABLE … RENAME CONSTRAINT`.
