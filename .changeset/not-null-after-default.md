---
"@supabase/pg-delta": patch
---

A column that gains `NOT NULL` and a new or changed default in one plan now gets `SET DEFAULT` before `SET NOT NULL`, so a backfill can go between them. When the default can run a user function (directly or through a domain check), the plan commits more than once (such as for an enum `ADD VALUE`), or that order would delay adding a new column to a table that gains several, the plan keeps its previous order. A changed default now also waits for the same-plan creation of what its expression references, so a default cast to a new enum or domain no longer fails at apply on a column that keeps its type.
