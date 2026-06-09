---
"@supabase/pg-delta": patch
---

Order dependent view drops before column type rewrites, and preserve view or materialized-view metadata when those dependents are dropped and recreated during replacement.
