---
"@supabase/pg-delta": patch
---

A trigger that switches to a new function, or to a new `UPDATE OF` column, while the old one is dropped in the same plan is now changed with `CREATE OR REPLACE TRIGGER` before that drop, instead of being dropped and recreated. It keeps the SHARE ROW EXCLUSIVE lock and the TRIGGER-privilege requirement of other trigger definition changes.
