# pg-delta-next — remaining work (detailed breakdown)

- **Date**: 2026-06-14
- **Branch**: `feat/pg-delta-next`
- **Parent**: [`../pg-delta-next-remaining-work.md`](../pg-delta-next-remaining-work.md)
  is the one-page tiered overview. This folder expands **each tier and each
  missing step into its own document with implementation details** —
  engine substrate that already exists → the surface still to build → concrete
  steps → tests → cross-links.

## Baseline (what is already done)

The engine is **code-complete (stages 0–9)**, the **hardening plan is fully
shipped** (all 8 items — [`../pg-delta-next-hardening-plan.md`](../pg-delta-next-hardening-plan.md)),
**4b (the extension-member provenance flip)** is done, and the
**security-label end-to-end proof** is done (`9da030d`). Everything in this
folder is *beyond* that baseline. See
[`../../packages/pg-delta-next/README.md`](../../packages/pg-delta-next/README.md)
and [`../../packages/pg-delta-next/COVERAGE.md`](../../packages/pg-delta-next/COVERAGE.md).

## Status legend

| Symbol | Meaning |
|---|---|
| 🔴 | Net-new engineering; blocked on a decision |
| 🟠 | Net-new engineering; ready to start |
| 🟡 | Substrate exists; build the consumer/surface |
| 🟢 | Product / process decision, not engineering |
| ⚪ | Deliberate deferral (documented, regression-free) |

## The documents

### Tier 1 — Unimplemented engineering feature

- 🔴 [Extension-intent Phase B](tier-1-extension-intent-phase-b.md) — replay
  `pgmq.create` / `cron.schedule` / `partman.create_parent` on a from-scratch
  rebuild. The single biggest open item; the *code plan* is ready, the
  **declarative-format decision (CLI-1431)** is the real gate.

### Tier 2 — Product / cutover decision

- 🟢 [Stage 10 cutover](tier-2-stage-10-cutover.md) — take the
  `@supabase/pg-delta` name, deprecate the old engine, write the migration
  guide. Gated on the six-condition parity bar (operationalized here).

### Tier 3 — CLI / productization layer (engine ready, consumer not built)

- 🟡 [Risk classification 2.0](tier-3-risk-classification.md) — CLI-1459–1464
- 🟡 [Migration squash / repair](tier-3-migration-squash-repair.md) — CLI-1597, 1598, 1424
- 🟡 [Object-filtering flags](tier-3-object-filtering-flags.md) — CLI-1006, 1169, 1432
- 🟡 [Service-migration baselines](tier-3-service-migration-baselines.md) — CLI-1436
- 🟡 [Stripe Sync Engine reset](tier-3-stripe-sync-engine-reset.md) — CLI-1582
- 🟡 [Typed auth errors](tier-3-typed-auth-errors.md) — CLI-1607
- 🟡 [extractDepends performance](tier-3-extract-depends-perf.md) — CLI-1603

### Tier 4 — Deliberate deferrals

- ⚪ [Deferrals](tier-4-deferrals.md) — 4b's deferred extractor families,
  not-modeled object kinds, parallel snapshot extraction, the security-label CI
  prebuild, and PGlite in the trusted path.

## Recommended order (if the goal is shipping pg-delta-next as the product)

1. **Decide the intent declarative format (CLI-1431)**, then build
   **[Extension-intent Phase B](tier-1-extension-intent-phase-b.md)** — the only
   remaining *engineering feature*.
2. **Build the [Tier 3 layer](#tier-3--cli--productization-layer-engine-ready-consumer-not-built)** —
   thin, independently shippable consumers over the ready engine. Risk
   classification 2.0 and squash/repair are the meatiest; the filter flags,
   baselines, auth errors, and perf tuning are small.
3. **[Stage 10 cutover](tier-2-stage-10-cutover.md)** — a product decision once
   the parity bar is demonstrably met.

Tier 4 items are pick-up-anytime polish with no urgency.

## Conventions used in these docs

- **Code citations are workspace-relative** (`packages/pg-delta-next/src/...`)
  and were verified on `feat/pg-delta-next` at the date above.
- Every doc follows the repo's **Test-Driven Fixes** discipline: the
  "Tests" section names the RED test to author *before* the production change.
- Linear issue IDs map to the project *pg-delta: database diffing 2.0*; see
  [`../pg-delta-next-linear-assessment.md`](../pg-delta-next-linear-assessment.md)
  for the full per-issue verdicts.
