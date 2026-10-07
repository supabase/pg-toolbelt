---
"@supabase/pg-delta": patch
---

Keep column grants in the grouped declarative export, so an unchanged export no longer makes `declarative sync` revoke them.
