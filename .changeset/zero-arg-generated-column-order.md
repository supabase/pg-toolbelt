---
"@supabase/pg-delta": patch
---

Fix planning a new table whose generated column can run a user function but reads none of the table's columns, such as `GENERATED ALWAYS AS (app.f()) STORED`. Postgres can run that function when the column is added, so a function that read a later column failed with `column ... does not exist`. Such a column, and any later column that runs a user function after it, no longer holds back the later columns that run none, so those can land first, which changes what `SELECT *`, an `INSERT` without a column list and the table's row type see. Some shapes still fail as before, such as `id + app.f()`, or an existing function that reads a later column whose type the plan creates.
