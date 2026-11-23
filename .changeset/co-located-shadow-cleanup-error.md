---
"@supabase/pg-delta": patch
---

Stop `provisionCoLocatedShadow().cleanup()` from hiding a failed `DROP DATABASE`. A new `onCleanupError` option receives the error when the throwaway `pgdelta_shadow_*` database cannot be dropped; `cleanup()` still resolves. `schema apply` without `--shadow` now prints a warning naming the database to drop manually.
