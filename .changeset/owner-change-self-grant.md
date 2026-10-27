---
"@supabase/pg-delta": patch
---

Plan owner changes a non-superuser applier cannot run directly. When the applier may grant itself the new owner role (CREATEROLE on PG 14/15; ADMIN on the role on PG16+, which `CREATE ROLE` gives its creator), the plan wraps the change in `GRANT r TO <applier>` … `REVOKE r FROM <applier>` and runs the new owner's schema `CREATE` grant first. The capability probe now uses `SET` on PG16+ and reads `createrole_self_grant` and supautils reserved memberships. An owner change that still cannot be planned throws the exported `CapabilityError` instead of a plain `Error`.
