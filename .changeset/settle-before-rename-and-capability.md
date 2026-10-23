---
"@supabase/pg-delta": patch
---

`planSchemaFiles` (`schema apply`) now settles spelling-only definition differences before rename discovery and before the capability check, so a renamed table whose checks are only respelled, named or not, is renamed instead of dropped and recreated, and an unchanged schema no longer fails with `capability: cannot set owner`. Two table renames in one schema no longer fail with a `dependency cycle`.
