---
"@supabase/pg-delta": patch
---

Live extraction now drops PG16+ implicit CREATEROLE ADMIN memberships granted by the bootstrap superuser, matching the shadow-load strip, so a baseline of roles created by a non-superuser `postgres` applies to an empty branch without `ADMIN option cannot be granted back to your own grantor`.
