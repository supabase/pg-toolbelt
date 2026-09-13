---
"@supabase/pg-delta": patch
---

`schema export --profile supabase` now round-trips named-role default grants onto an auto-expose-ON baseline. Absence of `anon` (or another overlay grantee) is a `REVOKE ALL` on create, not a silent keep of the load environment's injectee. A desired ADP that is a subset of the dest injectee is wipe-then-grant (`REVOKE ALL` then `GRANT` the live set) so extra dest privileges do not linger. Overlay hygiene also fires on `supabasePolicy` DB-to-DB creates. Overlay tuples live on the policy (`assumedDefaultGrants`); the planner still has no platform role names of its own.
