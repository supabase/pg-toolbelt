---
"@supabase/pg-delta": patch
---

A column that gains `NOT NULL` and a new or changed default in one plan now gets `SET DEFAULT` before `SET NOT NULL`, so a backfill can go between them. When that order would close a dependency cycle (a default that calls a new function reading the column), or the plan has a commit such as an enum `ADD VALUE` not already ordered against `SET NOT NULL`, the plan keeps its previous order. A changed default now also waits for the same-plan creation of what its expression references, so a default cast to a new enum or domain no longer fails at apply.
