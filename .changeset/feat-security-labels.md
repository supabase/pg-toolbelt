---
"@supabase/pg-delta": minor
---

feat(pg-delta): add support for PostgreSQL SECURITY LABEL across all 17 supported object types (schemas, tables, columns, views, materialized views, sequences, functions, procedures, aggregates, composite/enum/range types, domains, event triggers, foreign tables, publications, subscriptions, roles). Includes round-trip fidelity, a new `scope: "security_label"` in the filter DSL, and per-provider filtering via the new `provider` extractor.
