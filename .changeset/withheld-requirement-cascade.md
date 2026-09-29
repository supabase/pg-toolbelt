---
"@supabase/pg-delta": patch
---

Skip kept creates/alters whose prerequisite the policy withholds and the target lacks, instead of throwing a missing-requirement error or emitting DDL that fails at apply. A user trigger on a reference-only `supabase_migrations.schema_migrations` (CLI-2300), pgsodium column defaults, views and security labels (CLI-2342), and views over a Wrappers foreign table (CLI-2178) are now reverted at plan time into `filteredDeltas`, together with their subtree and any new consumers, and reported as `excluded-by-cascade` warnings in `plan.diagnostics`. Prerequisites that exist on the target, are produced by the plan, or are platform-provisioned still plan as before.
