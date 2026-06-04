---
"@supabase/pg-delta": patch
---

feat(pg-delta): emit `VALIDATE CONSTRAINT` shortcut when only `validated` flips from false to true

When the only difference between main and branch for an existing table constraint is `convalidated` flipping from `false` to `true` (i.e. the user wants to validate a previously `NOT VALID` constraint), pg-delta now emits a single `ALTER TABLE ... VALIDATE CONSTRAINT ...` instead of dropping and re-adding the constraint.

`VALIDATE CONSTRAINT` only takes `SHARE UPDATE EXCLUSIVE` on the table (concurrent reads and writes continue while the row scan runs), whereas drop+add takes `ACCESS EXCLUSIVE` for the duration of the scan. This matches the standard "ADD CONSTRAINT ... NOT VALID; later VALIDATE CONSTRAINT" two-phase safe-migration pattern.

The reverse direction (`validated` → `NOT VALID`) has no equivalent Postgres command, so it still goes through drop+add. Any other field change (expression, key columns, FK target, on_delete, etc.) on top of a `validated` flip also still goes through drop+add — the shortcut applies only when nothing else differs.
