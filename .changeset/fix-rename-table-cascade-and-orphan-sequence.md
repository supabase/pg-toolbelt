---
"@supabase/pg-delta": patch
---

fix(pg-delta): produce applyable migrations for `RENAME` operations seen as drop+create

`pg-delta` is a state-based diff and treats a `RENAME` as `DROP+CREATE` because
the final catalogs are indistinguishable. Two scenarios in that drop+create
path failed at apply time on schemas that had been renamed in the target
(reported in [#228](https://github.com/supabase/pg-toolbelt/issues/228)):

- A table with a `SERIAL` column renamed in the target left the same-name
  sequence (e.g. `old_table_id_seq`) "altered" in the diff (only its
  `OWNED BY` ref changed). `DROP TABLE` cascade-drops the sequence via
  `OWNED BY`, after which the freshly created table's column default
  `nextval('old_table_id_seq'::regclass)` referenced a non-existent relation
  and the migration aborted. `diffSequences` now detects when the sequence's
  main-side owning table is going away in the same plan and recreates the
  sequence after the cascade, while suppressing an explicit `DROP SEQUENCE`
  that would form an unbreakable cycle with `DropTable`.
- A table renamed in the target with a dependent view (e.g.
  `CREATE VIEW user_count AS SELECT count(*) FROM users` with the table
  renamed to `members`) failed with `cannot drop table users because other
  objects depend on it`. `expandReplaceDependencies` now seeds drop-only
  schema objects (table, view, materialized view, type, domain) as expansion
  roots so any surviving dependent in `pg_depend` gets promoted to
  `DROP+CREATE`. The dependent's drop is sequenced before the parent drop,
  and its create runs after the new replacement is in place.
