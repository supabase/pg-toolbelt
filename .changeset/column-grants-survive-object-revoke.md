---
"@supabase/pg-delta": patch
---

Keep a role's column-level grants when its object-level grant on the same relation is (re)applied. PostgreSQL revokes matching column privileges with any table-level `REVOKE`, and every object-level acl action leads with `REVOKE ALL ON <rel> FROM <role>`, so column grants on tables, views and materialized views were silently wiped whenever that role's object-level grant was added, changed or removed (or the relation was created under default privileges). The planner now orders every same-grantee column `GRANT` after that `REVOKE` and re-grants the untouched column privileges after it.
