---
"@supabase/pg-delta": patch
---

Diff the grants on schema `public` under a profile baseline. Baseline subtraction no longer removes them, so adding or removing a `REVOKE` on `public` in the declarative files now plans the matching `REVOKE` or `GRANT` instead of an empty sync. With a baseline, export now writes `public`'s grants the same way it does without one.
