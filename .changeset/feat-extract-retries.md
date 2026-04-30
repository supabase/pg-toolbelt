---
"@supabase/pg-delta": minor
---

feat(pg-delta): retry catalog extractors when `pg_get_*def()` returns NULL

`pg_get_indexdef`, `pg_get_constraintdef`, `pg_get_viewdef`, `pg_get_triggerdef`, `pg_get_ruledef`, and `pg_get_functiondef` can transiently return NULL when the underlying catalog row is dropped concurrently or the catalog state is in flux. Previously such rows were dropped silently after one attempt; now extraction retries the affected query a configurable number of times before falling back to filtering. In practice the second attempt no longer sees the dropped object (or successfully resolves the definition), so a real CREATE/DROP racing with `createPlan` is reliably preserved or excluded rather than half-captured.

Configuration (precedence: option > env > default):

- `CreatePlanOptions.extractRetries?: number` — public API option on `createPlan`.
- `PGDELTA_EXTRACT_RETRIES` env var — same value, useful for CLI usage.
- Default `1` (i.e. the first attempt plus one retry, 2 attempts total).

After retries are exhausted, rows whose `pg_get_*def()` is still NULL are filtered out and a warning is emitted via `debug('pg-delta:extract')` (visible with `DEBUG=pg-delta:extract` or `DEBUG=pg-delta:*`). Setting `extractRetries: 0` disables retrying entirely and reproduces the previous "filter-on-first-attempt" behavior.
