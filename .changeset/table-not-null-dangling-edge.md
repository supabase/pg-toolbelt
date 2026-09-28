---
"@supabase/pg-delta": patch
---

Stop reporting a `dangling_edge` warning for every NOT NULL column on PostgreSQL 18

PostgreSQL 18 catalogs a table column's NOT NULL as a `pg_constraint` row
(`contype = 'n'`, auto-named `<table>_<column>_not_null`). pg-delta models NOT
NULL as an attribute on the column fact, not as a constraint fact, so the
dependency resolver produced an edge to a fact that does not exist — one
`WARNING [dangling_edge]` per NOT NULL column on every `plan`, `diff`, and
`snapshot`, burying real diagnostics.

The rows are now excluded from dependency resolution, sharing one predicate with
the domain-side exclusion added for the same reason. Diagnostics only: the edge
was already discarded, so the fact base, hashes, and plans are unchanged.

A `COMMENT ON CONSTRAINT` attached to one of those rows has nowhere to live once
the row is skipped, so extraction now reports it as an info
`table_not_null_comment_skipped` diagnostic instead of dropping it without a
word — mirroring the domain-side `domain_not_null_comment_skipped`.
