---
"@supabase/pg-delta": patch
---

Fix creating a table whose generated column calls a user function and reads no column of its own table, such as `GENERATED ALWAYS AS (app.f()) STORED`. Postgres runs that call when the column is added. Before, the column was added ahead of the columns declared after it, so a function that reads one of those columns failed with `column ... does not exist`. Now the column is added after them. One case still fails: a generated column that reads a column of its own table and also calls an `IMMUTABLE` function with only constant arguments, such as `id + app.f()`. Postgres runs that call when the column is added too, so it fails when the function needs a column or object the plan creates later.
