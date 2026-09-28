---
"@supabase/pg-delta": patch
---

Cast through `text` (`text[]` for array columns) when a column is retyped from one enum to a differently named enum, so the migration no longer fails with "cannot cast type … (42846)". Retypes from an enum to a non-enum type keep the direct cast, so user-defined casts still apply.
