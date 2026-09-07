---
"@supabase/pg-delta": patch
---

fix(pg-delta): do not plan a duplicate CREATE for a platform event trigger hidden by owner on one side only, and project out event triggers whose function is superuser-owned when the applier is not a superuser (CLI-2341)
