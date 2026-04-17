---
"@supabase/pg-delta": patch
---

fix(pg-delta): break drop-phase cycles for owned-sequence column drops and replace-dependency table recreates

Two previously unbreakable drop-phase `CycleError`s are now fixed at the
source by eliding redundant changes instead of patching the sort-phase
cycle filter.

- `diffSequences` now skips `DROP SEQUENCE` when the owning column is
  dropped on a surviving table (e.g. dropping a `SERIAL` column).
  PostgreSQL's `OWNED BY` cascade already drops the sequence with the
  column, so emitting `DROP SEQUENCE` both failed at apply time and formed
  an unbreakable cycle with `AlterTableDropColumn`. This mirrors the
  existing short-circuit for whole-table drops.
- `expandReplaceDependencies` now removes pre-existing
  `AlterTableDropColumn(T.col)` and `AlterTableDropConstraint(T.c)` changes
  when it enqueues a `DropTable(T) + CreateTable(T)` replacement pair for
  the same table. Those are the only `AlterTable*` subclasses whose
  `requires` includes `table.stableId`, producing a `column:T.col → table:T`
  (or `constraint:T.c → table:T`) explicit edge that closed an unbreakable
  drop-phase cycle against catalog `constraint → column → table` edges.
  Supersession is scoped to those two classes only; other `AlterTable*(T)`
  changes (owner, RLS toggles, replica identity, storage params,
  SET LOGGED/UNLOGGED) and privilege-scope ALTERs (GRANT/REVOKE) are
  preserved so the recreated table ends up in the correct state — the sort
  phase orders them after `CreateTable(T)` via their `table.stableId`
  requirement.
