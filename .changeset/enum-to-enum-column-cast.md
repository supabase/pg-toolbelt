---
"@supabase/pg-delta": patch
---

Cast through `text` (`text[]` for array columns) when a column is retyped away from an enum, so a retype to a differently named enum no longer fails with "cannot cast type … (42846)".
