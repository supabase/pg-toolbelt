---
"@supabase/pg-delta": patch
---

fix(pg-delta): skip redundant `ALTER TABLE … ADD CONSTRAINT` for CHECK constraints inherited by partition children

Previously the inheritance signal used `pg_constraint.conparentid <> 0`, but PostgreSQL only populates `conparentid` for PK / UNIQUE / FK constraints on partitions — CHECK constraints on partitions always have `conparentid = 0`. As a result, pg-delta re-emitted every inherited CHECK constraint against each partition, and apply failed with SQLSTATE 42710 ("constraint already exists") because the constraint had already been auto-created on the partition by Postgres when the parent's constraint or the partition itself was created. The extractor now uses `coninhcount > 0`, the canonical inheritance flag, which covers CHECK and all other constraint kinds uniformly.
