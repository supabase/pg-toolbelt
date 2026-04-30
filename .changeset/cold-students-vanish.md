---
"@supabase/pg-delta": patch
---

Fix view diffs to drop and recreate views when the projected column list changes (for example when `SELECT *` views need to pick up a new base-table column), instead of emitting `CREATE OR REPLACE VIEW`.
