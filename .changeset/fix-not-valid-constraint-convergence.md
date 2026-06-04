---
"@supabase/pg-delta": patch
---

fix(pg-delta): stop re-validating NOT VALID constraints

A NOT VALID constraint was followed by a VALIDATE CONSTRAINT step that flipped it back to validated, so the plan never converged. ADD CONSTRAINT already carries the NOT VALID suffix, so the VALIDATE was redundant. It's now dropped from the create, alter, and table-replacement paths.
