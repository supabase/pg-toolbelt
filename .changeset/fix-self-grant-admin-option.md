---
"@supabase/pg-delta": patch
---

fix(roles): skip self-granted memberships to avoid ADMIN option error on PG 17+
