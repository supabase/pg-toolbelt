---
"@supabase/pg-delta": patch
---

A trigger definition change now falls back to drop + create, instead of an in-place alter, when the plan evaluates a user function before the change can run (for example a new column the trigger reads whose `DEFAULT` calls a function). Altered in place, the old trigger stayed active during that evaluation and could fire on writes the function made. Disabled triggers are unaffected.
