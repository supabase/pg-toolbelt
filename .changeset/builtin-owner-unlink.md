---
"@supabase/pg-delta": patch
---

fix(pg-delta): plan ALTER … OWNER TO when source ownership is a built-in `pg_*` role (e.g. `pg_database_owner`) and the desired owner is the implicit defaultOwner, so schema ACL revokes cannot strip the applier's CREATE before creates in that schema
