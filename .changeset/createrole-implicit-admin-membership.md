---
"@supabase/pg-delta": patch
---

A PG16+ CREATEROLE non-superuser cannot replay `GRANT <role> TO <self> WITH ADMIN OPTION` (SQLSTATE 0LP01); `CREATE ROLE` already recreates that membership. When plan/prove receive applier capability (the same opt-in as FDW ACLs), those admin self-memberships are projected out of the managed view. Extract stays a catalog dump.
