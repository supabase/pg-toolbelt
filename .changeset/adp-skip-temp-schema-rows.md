---
"@supabase/pg-delta": patch
---

Skip default-privilege rows scoped to system or per-session temp schemas (`ALTER DEFAULT PRIVILEGES … IN SCHEMA pg_temp_N`) at extract time. Such a row keyed a `defaultPrivilege` fact on a schema that exists on no target and no plan produces, so planning against a database carrying one failed in `buildActionGraph` with `missing requirement: … consumes schema:pg_temp_N`.
