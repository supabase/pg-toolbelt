---
"@supabase/pg-delta": minor
---

Privileges on the sequence behind a `GENERATED … AS IDENTITY` column are now tracked. A `GRANT` or `REVOKE` on that sequence is extracted, shows up in `schema diff` and `schema plan`, is exported into the owning table's file, and survives `schema apply` and `load(export(db))`. Previously such grants were invisible: a role granted `USAGE` on an identity sequence lost it when the schema was recreated, and a project whose default privileges grant sequence access kept that access on identity sequences the source had revoked. The owner's untouched default on its own sequence is not exported, so exports of plain identity tables are unchanged.
