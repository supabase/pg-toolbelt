---
"@supabase/pg-delta": patch
---

`plan()` no longer throws when a non-superuser applier cannot run an `ALTER … OWNER TO` (it is not a member of the owner role). The owner ALTER is still planned and flagged with a `capability.owner` warning in `plan.diagnostics`, so read-only diffs render again now that `resolveProfile` probes the applier by default. `apply()` and the `schema apply --dry-run` script refuse a plan carrying that warning before running or emitting any statement, and the flagged owners are part of the `planId`, so stripping the warning invalidates the plan.
