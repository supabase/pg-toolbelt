---
"@supabase/pg-delta": patch
---

Defer drop-phase cycle breaking from `normalizePostDiffCycles` to a lazy
dispatcher invoked by `sortPhaseChanges` only when edge filtering can't
break a cycle. The happy path (no cycles, the vast majority of plans) no
longer walks `iterCrossDropFkConstraints` on every diff. The new
dispatcher generalizes the existing 2-cycle FK breaker to any
N≥2 strongly-connected component of dropped tables (for example
`a→b→c→a`) and breaks the
`AlterPublicationDropTables ↔ AlterTableDropColumn` cycle that occurred
when a publication-listed column was dropped on a surviving table. The
breaker round-cap scales with `phaseChanges.length` so big diffs with
many independent unbreakable cycles in a single phase resolve cleanly
instead of throwing a spurious `CycleError`.

The sequence diff path now alters `data_type` in place via
`ALTER SEQUENCE ... AS <type>` (valid PostgreSQL since PG10) instead of
emitting `DROP SEQUENCE + CREATE SEQUENCE`. This eliminates a
production `CycleError` seen on alpha.16 (Sentry SUPABASE-API-7RS,
"DropSequence ↔ DropTable") triggered when a sequence whose
`data_type` changes is referenced by a `DEFAULT nextval(...)` on a
surviving column. Altering in place also fixes a silent data-loss
regression where the recreated sequence would restart at `1` and
collide with existing row ids.
