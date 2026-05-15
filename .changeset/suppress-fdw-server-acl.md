---
"@supabase/pg-delta": patch
---

fix(pg-delta): suppress GRANT/REVOKE on FOREIGN DATA WRAPPER in the supabase integration

`GRANT`/`REVOKE ... ON FOREIGN DATA WRAPPER` requires superuser. On Supabase Cloud the `postgres` role has the elevated rights to apply these grants, but the local Docker image does not — so the previous diff output broke `supabase db reset` with `permission denied for foreign-data wrapper dblink_fdw`. The existing system-role rule already covers wrappers owned by `supabase_admin`, but `pg_dump` rewrites OWNER TO clauses to whoever the dump runs under, so after a restore the FDW ends up owned by `postgres` and slips past the owner gate. The supabase integration filter now drops privilege-scope changes on `foreign_data_wrapper` regardless of owner, since the FDW ACL is never user-replayable in the local image. `FOREIGN SERVER` ACL is intentionally left alone — server GRANT/REVOKE doesn't require superuser, and user-created servers (e.g. a `dblink` server pointing to a peer DB) carry legitimate user ACL that should still roundtrip.
