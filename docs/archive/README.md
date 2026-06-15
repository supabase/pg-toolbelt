# archive — build history (not current)

These documents are a **point-in-time record** of how `pg-delta-next` was built
and reviewed. They are preserved for onboarding and to keep the rationale trail,
**not** as a description of the engine as it is today.

> Where these differ from the code or from [`../architecture/`](../architecture/),
> trust the code and `architecture/`. Status banners inside some of these docs
> ("not started", "TODO") reflect the moment they were written, not now.

## What's here

### Stage build plan (all shipped)

The clean-room rebuild was executed as a sequence of stages, each gated on the
previous. Each doc states what that layer set out to do and why.

| Stage | Layer |
|---|---|
| [stage-00-test-suite.md](stage-00-test-suite.md) | Test architecture + scenario corpus, stood up *before* engine code |
| [stage-01-fact-core.md](stage-01-fact-core.md) | Identity codec, facts, edges, hashing, Merkle rollups, snapshot format |
| [stage-02-extractors.md](stage-02-extractors.md) | Catalog → fact base extraction queries |
| [stage-03-proof-harness.md](stage-03-proof-harness.md) | The proof loop + differential runner (the safety net) |
| [stage-04-diff.md](stage-04-diff.md) | Generic, zero-per-kind diff |
| [stage-05-planner.md](stage-05-planner.md) | Rule table, atomic actions, one graph, deterministic sort |
| [stage-06-execution.md](stage-06-execution.md) | Plan artifacts, segmented lock-aware apply |
| [stage-07-frontends.md](stage-07-frontends.md) | Shadow-DB SQL loader, snapshots, declarative workflow |
| [stage-08-policy.md](stage-08-policy.md) | Policy DSL v2, baseline subtraction, Supabase package |
| [stage-09-renames-api.md](stage-09-renames-api.md) | Rename detection, public API, CLI |
| [stage-10-cutover.md](stage-10-cutover.md) | The switch-over plan (forward-looking; see [../roadmap/](../roadmap/)) |

### Post-build records

- **[hardening-plan.md](hardening-plan.md)** — eight hardening items closing gaps
  between the first implementation and the north star (all shipped, incl. the 4b
  provenance flip and the planner split).
- **[linear-assessment.md](linear-assessment.md)** — how each of 134 tracked
  issues maps onto the new engine; most are resolved by construction.
- **[v1-readiness-review.md](v1-readiness-review.md)** — an independent review of
  v1 readiness; its findings drove the final correctness-and-trust work.
