---
"@supabase/pg-delta": patch
---

fix(pg-delta): stop emitting spurious `CREATE OR REPLACE TRIGGER` on logically-identical triggers whose underlying tables have different physical column layouts.

The trigger diff was comparing `pg_trigger.tgattr` (raw physical attnums) as part of its non-alterable fields. When the same logical trigger (e.g. `BEFORE UPDATE OF col_a, col_b ...`) existed on two tables with different physical column layouts — one built via a single `CREATE TABLE`, the other grown via `ALTER TABLE DROP/ADD COLUMN` (which leaves "dead" attnums that are never renumbered) — the attnum vectors diverged while the trigger definition (rendered by `pg_get_triggerdef()` using column names) was byte-identical. The diff kept firing a `ReplaceTrigger` every round, and because `CREATE OR REPLACE TRIGGER` does not renumber the table's physical columns, the loop never converged.

Triggers are now compared by `pg_get_triggerdef()` output (column names) instead of raw `tgattr` attnums, matching the existing `Index` pattern that handles the same class of bug for `indkey`.
