---
"@supabase/pg-delta": patch
---

A column that gains `NOT NULL` and a new or changed default in one plan now gets `SET DEFAULT` before `SET NOT NULL`, so a backfill can go between them. When that order would close a dependency cycle (a default that calls a new function reading the column), the plan keeps its previous order instead of failing. A changed default now also waits for the same-plan creation of what its expression references, so a default cast to a new enum or domain no longer fails at apply.
