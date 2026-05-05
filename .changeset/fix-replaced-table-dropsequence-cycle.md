---
"@supabase/pg-delta": patch
---

Fix `DropSequence ↔ DropTable` drop-phase cycle when an owning table is
promoted to `DropTable + CreateTable` by `expandReplaceDependencies` (for
example when a referenced enum has a label removed) and the same plan also
drops the SERIAL sequence because branch no longer carries the owned sequence.

`diffSequences.dropped` short-circuits `DropSequence` only when the owning
table itself is absent from the branch catalog. When the table survives in
branch but is later replaced via expansion (table is in `replacedTableIds`),
the explicit `DROP SEQUENCE` survives into the drop phase alongside the
expander's `DropTable`, and the bidirectional pg_depend edges between the
sequence and its owning column close an unbreakable 2-cycle that none of the
existing dependency-filter / change-injection breakers match.

`normalizePostDiffChanges` now prunes `DropSequence(S)` whenever S is `OWNED
BY` a column on a table in `replacedTableIds`. The `DROP TABLE` cascade
already drops the OWNED BY sequence at apply time, so the explicit
`DROP SEQUENCE` was both redundant and the source of the cycle.
