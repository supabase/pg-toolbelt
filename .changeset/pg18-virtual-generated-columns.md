---
"@supabase/pg-delta": patch
---

Create PostgreSQL 18 `VIRTUAL` generated columns as `VIRTUAL` instead of `STORED`, and replace the column when it changes between `STORED` and `VIRTUAL`. Replacing a column that an `INHERITS` child redeclares now drops the parent's column first and adds it back last, so the plan applies. A change of generation kind is refused when a partition or `INHERITS` child overrides the generation expression on a column it does not declare, since replacing the column would reset it. A type change on a `VIRTUAL` column no longer reports a rewrite risk.
