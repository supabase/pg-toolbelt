---
"@supabase/pg-delta": minor
---

On PostgreSQL 16 and later, a role membership's `INHERIT` and `SET` options are now part of the schema: a difference between two databases is planned as `GRANT role TO member WITH INHERIT …, SET …`, and exports write the options a plain `GRANT` would not give. Before, only `ADMIN` was compared, so a role that had granted itself a role it created looked identical to one that had not. PostgreSQL 15 and older are unchanged. For a non-superuser applier, its own membership is managed in two states only (it holds the role with both options, or with neither); any other case is left as found and reported as a plan warning.
