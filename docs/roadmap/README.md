# pg-delta-next — remaining work (detailed breakdown)

- **Date**: 2026-06-14
- **Branch**: `feat/pg-delta-next`
- **Parent**: [`../pg-delta-next-remaining-work.md`](v1.md)
  is the one-page roadmap (the **correctness-first v1** plan). This folder is the
  per-item implementation detail.

## Baseline (done + proven)

Engine code-complete (stages 0–9), hardening plan + 4b + security-label e2e, and
the **managed-view architecture** ([`../managed-view-architecture.md`](../architecture/managed-view-architecture.md):
`skipSchema`/`skipAuthorization` eliminated, ownership-as-edge, fact-level view,
applier capability). The validation harness runs in CI on **PG 15/17/18**:
corpus 209×2 (418 cases) under the proof loop (`EXPECTED_RED` empty), a new-vs-old
**differential** with a hard regression gate, a **generative soak** with an
enforced kind-coverage checklist, reviewed public API. **The engine + its
correctness machinery are v1-ready** — see the parent doc for the cut plan.

## Status legend

| Symbol | Meaning |
|---|---|
| 🟠 | Net-new engineering; ready to start |
| 🟢 | Validation / product / process (not new engine code) |
| 🔴 | Net-new engineering; blocked on a decision |
| 🟡 | Substrate exists; build the consumer/surface |
| ⚪ | Deliberate deferral (documented, regression-free) |

## v1 — correctness blockers

- ✅ **[Unmodeled-kind detection](v1-unmodeled-kind-detection.md)** — **shipped**.
  The provenance-aware catalog completeness check (diagnostic + `--strict-coverage`)
  closes the one real correctness gap. v1 detects unmodeled kinds; *modeling*
  them is post-v1.
- ✅ **v1-readiness-review findings** ([../pg-delta-next-v1-readiness-review.md](../archive/v1-readiness-review.md))
  — **shipped**: CLI diagnostic surfacing + `--strict-coverage`; `Policy.baseline`
  fail-loud (`resolveBaseline`); SQL loader rejects self-managed transactions;
  comment/status drift corrected.
- 🟢 **Validation at scale** — run the gates to green for the record: full
  differential (`=all`) triaged clean; generative soak at the agreed quota; one
  large real-world schema through plan+prove; **commit the Supabase baseline**
  ([service-migration-baselines](tier-3-service-migration-baselines.md)). Record
  it in [`../pg-delta-next-v1-evidence.md`](v1-evidence.md).
- 🟢 **v1 scope statement** — publish what v1 manages / deliberately doesn't
  (from `COVERAGE.md` + the completeness diagnostic).

## Post-v1 milestone A — performance

- ✅ [extractDepends perf](tier-3-extract-depends-perf.md) — **shipped**.
  Profiling showed one correlated `pg_depend` resolver query was 86% of
  extraction (not round-trips, and not the parallel-extraction "big win" this
  line originally guessed). Rewriting it set-based made extraction **~4.2×**
  faster (the query itself **7×**), with byte-identical edges. Added a
  statement-timeout budget + actionable diagnostic. Parallel snapshot extraction
  is deferred — the re-profile shows it would now win < 2× for a large,
  consistency-critical refactor (the resolver query caps the ceiling).
- 🟠 [Memory-optimal extraction & diff](tier-3-extract-memory.md) — measured: the
  engine materializes both catalogs (held heap is lean ~660 B/fact, but `pg`
  buffers full result sets → transient peak is the OOM edge; ~comparable to the
  old engine). Plan: make held memory **O(changes)** via a two-pass
  hash-manifest → fetch-changed diff. **Phase 1** (cursor-stream the unbounded
  extractors + a `maxFacts` guard) is low-risk and ships the OOM-relevant win;
  the full manifest diff is gated on a real 250k+-object catalog need.

## Post-v1 milestone B — DX & cutover

- 🟡 [Risk classification 2.0](tier-3-risk-classification.md) — CLI-1459–1464
- 🟡 [Migration squash / repair](tier-3-migration-squash-repair.md) — CLI-1597, 1598, 1424
- 🟡 [Object-filtering flags](tier-3-object-filtering-flags.md) — CLI-1006, 1169, 1432
- 🟡 [Typed auth errors](tier-3-typed-auth-errors.md) — CLI-1607
- 🟡 [Stripe Sync Engine reset](tier-3-stripe-sync-engine-reset.md) — CLI-1582
- 🟡 **Applier-capability CLI wiring** — persistence shipped (`plan --restrict-to-applier`);
  extend through the rest of the flow (`managed-view-architecture.md` follow-up 2).
- 🔴 [Extension-intent Phase B](tier-1-extension-intent-phase-b.md) — replay on
  rebuild; blocked on the CLI-1431 declarative-format decision (Phase A ships).
- 🟢 [Stage 10 cutover](tier-2-stage-10-cutover.md) — naming, deprecation,
  migration guide, after v1 + perf land.

## Deliberate deferrals (not blocking any milestone)

- ⚪ [Deferrals](tier-4-deferrals.md) — 4b's deferred extractor families;
  **modeling** specific not-modeled kinds (now *detected + reported*); the
  security-label CI prebuild; PGlite in the trusted path.

## Conventions

- Code citations are workspace-relative (`packages/pg-delta-next/src/...`),
  verified on `feat/pg-delta-next` at the date above.
- Every doc follows **Test-Driven Fixes**: the "Tests" section names the RED test
  to author before the production change.
- Linear IDs map to the project *pg-delta: database diffing 2.0*; see
  [`../pg-delta-next-linear-assessment.md`](../archive/linear-assessment.md).
