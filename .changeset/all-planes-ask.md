---
"@supabase/pg-delta": patch
---

Handle dependent index and view recreation when replacing a materialized view. Constraint-owned, primary, and partition-attached indexes are left to the owning constraint or parent-index DDL so table replacement does not emit a standalone `DROP INDEX` on a PK-owned index.
