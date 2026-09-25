---
"@supabase/pg-delta": patch
---

Replace the partitioned table when a partition key column changes type or collation. Postgres rejects `ALTER COLUMN ... TYPE` and `DROP COLUMN` on a column in the partition key of its table or of any sub-partition. These plans failed to apply with "cannot alter column ... because it is part of the partition key of relation ...". pg-delta now reads key columns from `pg_depend` at extract time and replaces the partitioned table instead. The replace drops the table's rows, so the plan flags it as destructive.
