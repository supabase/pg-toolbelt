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
- `expandReplaceDependencies` now removes pre-existing object-scope
  `AlterTable*(T)` changes when it enqueues a `DropTable(T) + CreateTable(T)`
  replacement pair for the same table. The replacement rebuilds `T` from
  the branch shape, making prior structural alterations redundant.
  Previously, coexisting `DropTable(T)` and `AlterTableDropColumn(T.col)`
  produced a `column → table` explicit edge that closed an unbreakable
  cycle against catalog FK edges. Privilege-scope ALTERs (GRANT/REVOKE)
  are preserved so the recreated table still gets its grants.
