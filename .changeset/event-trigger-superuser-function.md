---
"@supabase/pg-delta": patch
---

fix(pg-delta): project out event triggers whose function is superuser-owned when the applier is not a superuser
