---
"@supabase/pg-delta": patch
---

fix(pg-delta): order dependency-breaking ALTERs before DROP for types, sequences, and policies (#230)

`ALTER COLUMN ... DROP DEFAULT`, `ALTER COLUMN ... DROP IDENTITY`, and
`ALTER COLUMN ... TYPE <built-in>` are now scheduled in the drop phase so
that the catalog edges in `pg_depend` order them ahead of the matching
`DROP TYPE` / `DROP SEQUENCE`. `ALTER COLUMN ... TYPE` also drops any
existing default before the rewrite (and re-emits a `SET DEFAULT` after)
so the stale default expression cannot pin the old type. RLS policies
whose `USING` / `WITH CHECK` expressions begin or stop referencing
different functions or relations are now emitted as drop+create, letting
the policy's drop run before the referenced object's drop and the
policy's recreate run after the new object's create. Plans that
previously aborted with PostgreSQL `2BP01` ("cannot drop ... because
other objects depend on it") now apply cleanly.
