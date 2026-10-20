---
"@supabase/pg-delta": patch
---

`plan` now refuses, instead of planning a wrong `CREATE USER MAPPING`, when a role is renamed and the source extraction could not read that role's user mapping (a non-superuser extractor). Postgres keeps the mapping attached across `ALTER ROLE ... RENAME`, so the extra `CREATE` failed at apply with `must be owner of foreign server` or `user mapping ... already exists`. The refusal names the mapping and asks for an extraction role that can read `pg_user_mapping`.
