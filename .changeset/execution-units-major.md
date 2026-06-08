---
"@supabase/pg-delta": major
---

Introduce execution-aware migration plans with transaction-aware migration units, structured execution effects, multi-file SQL rendering, and enum value visibility boundaries.

This is a breaking plan-shape change: callers should treat `units` as the primary execution surface and render through `renderPlanSql` or `renderPlanFiles`. Multi-unit plans are no longer fully atomic across the whole migration: earlier units can commit before later units run, and a later failure does not roll back already committed units. This matters especially for enum value additions, because PostgreSQL cannot drop an added enum value during automatic rollback.
