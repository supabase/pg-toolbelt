---
"@supabase/pg-delta": patch
---

Refresh generated-column expression dependents more precisely during routine replacement, including covered column recreations, child-specific partition expressions, and publication row filters without explicit column lists.
