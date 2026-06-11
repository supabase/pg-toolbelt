---
"@supabase/pg-delta": patch
---

Recreate dependent rules, triggers, generated column expressions, and publication table filters around function replacements and column rewrites so PostgreSQL can apply the generated migration without dependency errors.
