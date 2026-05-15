---
"@supabase/pg-delta": patch
---

fix(pg-delta): suppress GRANT/REVOKE on FOREIGN DATA WRAPPER and FOREIGN SERVER in the supabase integration

`GRANT`/`REVOKE ... ON FOREIGN DATA WRAPPER` requires superuser. On Supabase Cloud `postgres` has the elevated rights to apply these grants, but the local Docker image does not — so the previous diff output broke `supabase db reset` with `permission denied for foreign-data wrapper dblink_fdw`. FDW (and the adjacent `FOREIGN SERVER`) ACL is platform-managed state, not user-declarative state, so the supabase integration now drops privilege-scope changes for both object types regardless of owner.
