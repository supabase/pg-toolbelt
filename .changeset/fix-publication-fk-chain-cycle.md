---
"@supabase/pg-delta": patch
---

Fix drop-phase cycle breaking when publication table membership removal intersects with dropped foreign-key chains and a referenced constraint drop.
