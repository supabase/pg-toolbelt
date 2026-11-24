---
"@supabase/pg-delta": patch
---

Create PostgreSQL 18 `VIRTUAL` generated columns as `VIRTUAL` instead of `STORED`, and replace the column when it changes between `STORED` and `VIRTUAL`.
