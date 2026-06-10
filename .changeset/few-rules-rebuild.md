---
"@supabase/pg-delta": patch
---

Recreate dependent rules and triggers around function replacements and column rewrites so PostgreSQL can apply the generated migration without dependency errors.
