---
"@supabase/pg-delta": patch
---

A PG16+ CREATEROLE non-superuser cannot replay `GRANT <role> TO <self> WITH ADMIN OPTION` (SQLSTATE 0LP01); `CREATE ROLE` already recreates that membership. Extract stays a catalog dump. `resolveProfile` now probes applier capability by default (omitted or `true`) and projects those self-ADMIN memberships — plus existing FDW ACLs — out of the managed view for `plan`, `schema apply`, `diff`, and `schema export`. Pass `{ restrictToApplier: false }` / `--no-restrict-to-applier` (`plan` / `schema apply`) for an unrestricted view (plan-here / apply-as-more-privileged). `prove` reconstructs the plan artifact's capability and does not re-probe the clone. A superuser probe excludes nothing. Bare `plan()` stays unrestricted when capability is omitted.
