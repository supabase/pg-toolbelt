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
when a publication-listed column was dropped on a surviving table.
