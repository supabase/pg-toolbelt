---
"@supabase/pg-delta": patch
---

A changed trigger definition is now planned as `CREATE OR REPLACE TRIGGER` instead of `DROP TRIGGER` + `CREATE TRIGGER`. It takes a SHARE ROW EXCLUSIVE lock instead of ACCESS EXCLUSIVE, and for a trigger in the default `ENABLE` state it needs only the TRIGGER privilege, not table ownership. A disabled, replica, or always trigger gets its firing state restored after the replace. Constraint triggers, which `OR REPLACE` does not support, and a statement-level trigger on a partitioned table are still dropped and recreated. A column type change now also rebuilds the triggers that depend on that column.
