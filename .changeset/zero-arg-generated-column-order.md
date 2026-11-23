---
"@supabase/pg-delta": patch
---

Fix planning a new table whose generated column can run a user function but reads none of the table's columns, such as `GENERATED ALWAYS AS (app.f()) STORED`. Postgres can run that function when the column is added, so a function that read a later column failed with `column ... does not exist`. Such a column no longer holds back the later columns that run no user function, so it can land after them, which changes what `SELECT *` and `INSERT` or `COPY` without a column list see. Some shapes still fail as before, such as `id + app.f()`, or a function that reads a later column whose type the plan also creates.
