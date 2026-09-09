---
"@supabase/pg-delta": minor
---

Empty-target baselines can exhaust PostgreSQL's lock table in one
transaction. Call `estimateLockTableBudget` on the apply target, then
optionally `splitPlan({ maxLocks })` so each segment tries to stay under
that many lock slots. `apply` honors the marks and does not refuse.

CLI: `--max-locks <n>` (plan / apply / schema apply) and `--split-to-fit`
(apply / schema apply; probes the target). Extra COMMITs are only safe
when nothing else reads the target; off by default, so existing plans
and the corpus are unchanged.
