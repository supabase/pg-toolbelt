---
"@supabase/pg-delta": patch
---

Keep revokes of the default grants on schema `public` (to `PUBLIC`, and on Supabase to `anon`, `authenticated` or `service_role`) in the declarative export, so `declarative sync` no longer grants them back.
