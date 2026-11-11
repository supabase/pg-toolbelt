---
"@supabase/pg-delta": patch
---

A renamed table, domain, or foreign table now renames the constraint names Postgres generated from its old name (`t1_pkey` to `t2_pkey`) in the same plan. Before, the next plan renamed them, or dropped and re-added them (rebuilding a primary key, revalidating a check) when a check was respelled or the rename was accepted in prompt mode. A key whose new name another relation still holds is renamed by the next plan. A constraint on a foreign table is now renamed with `ALTER TABLE`, since Postgres rejects `ALTER FOREIGN TABLE … RENAME CONSTRAINT`.
