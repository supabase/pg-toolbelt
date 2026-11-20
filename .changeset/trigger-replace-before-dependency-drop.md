---
"@supabase/pg-delta": patch
---

A trigger that switches its `EXECUTE FUNCTION` or a function its `WHEN` calls, while the old function is dropped in the same plan, is now changed with `CREATE OR REPLACE TRIGGER` before that drop instead of being dropped and recreated. It applies only when nothing the dropped function itself depends on changes in that plan and no function reuses its name; otherwise the trigger is still dropped and recreated, as is a trigger whose old definition used a column the plan drops.
