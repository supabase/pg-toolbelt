---
"@supabase/pg-delta": patch
---

fix(pg-delta): prune duplicate constraint ADDs on tables promoted to drop+create

When a table transitively depends on a replaced object (for example a
foreign key whose referenced primary key is being dropped and re-added to
flip to `WITHOUT OVERLAPS` / `PERIOD`), `expandReplaceDependencies()`
promotes the table to a full `DropTable + CreateTable` pair and emits one
`AlterTableAddConstraint` (plus optional `VALIDATE CONSTRAINT` /
`COMMENT ON CONSTRAINT`) per branch constraint. The original
`diffTables()`-emitted `AlterTableAddConstraint` targeting the same
constraint on the same replaced table was previously left in the plan,
producing duplicate `ALTER TABLE ... ADD CONSTRAINT` statements and a
`constraint "..." for relation "..." already exists` apply failure.

`normalizePostDiffCycles()` now prunes same-table
`AlterTableAddConstraint`, `AlterTableValidateConstraint` and
`CreateCommentOnConstraint` changes when the table is in
`replacedTableIds`, mirroring the existing pruning of
`AlterTableDropColumn` / `AlterTableDropConstraint`. This fixes migrations
that combine a temporal-PK flip on one table with a temporal-FK flip on a
related table.
