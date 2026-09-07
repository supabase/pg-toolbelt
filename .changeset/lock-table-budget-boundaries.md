---
"@supabase/pg-delta": minor
---

Apply now probes the target lock table before the first DDL and fails fast with
`lock-table-budget-exceeded` when a transactional segment would not fit, instead
of dying mid-baseline with `out of shared memory`. The estimate reserves slots
for busy backends plus a new-connection margin.

Opt in to commit chunks with `baselineCommitEvery` / `--baseline-commit-every`
(plan and/or apply). Valid only when nothing else reads the target during apply;
off by default, so existing plans and the corpus are unchanged.
