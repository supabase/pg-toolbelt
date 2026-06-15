# Tier 2 — Stage 10 cutover at the parity bar

- **Status**: 🟢 Product / process decision, not engineering. **Has not
  happened.** pg-delta-next is still a private clean-room build *behind* the old
  `packages/pg-delta` engine (which remains the shipped product and the
  differential oracle).
- **Canonical plan**: [`../stage-10-cutover.md`](../archive/stage-10-cutover.md) (states
  the bar and the product mechanics). *This doc operationalizes "how do we know
  each condition is met" with current status + the verification command.*

## What "cutover" means concretely

Three mechanical changes, none of which is an engineering cliff if the earlier
gates held:

1. The new package **takes the `@supabase/pg-delta` name** (new major) or a new
   name — a product decision, recorded in the architecture doc's decision log
   when made.
2. The old engine gets a **`@deprecated` banner + README pointer** in its final
   minor (after cutover, not before) and enters **maintenance** (security +
   critical-correctness only, for a stated window).
3. The **migration guide** is written from the artifacts already accumulated
   (API mapping, plan-artifact format diffs, output-shape diffs, policy DSL
   v1→v2 cookbook, snapshot regeneration).

## The parity bar — operationalized (a conjunction; ALL must hold)

The bar is **cheap to state, expensive to regret** — hold it (guardrail 7). For
each condition: how to verify it *today*, and what is still missing.

| # | Condition | How to verify | Current status / gap |
|---|---|---|---|
| 1 | **Corpus 100% green**, `EXPECTED_RED` empty + deleted | `cd packages/pg-delta-next && bun test tests/engine.test.ts` on **all** supported PG versions (`PGDELTA_TEST_IMAGE=postgres:15-alpine`, …) | Corpus is green on PG15+17 and `EXPECTED_RED` is empty today; **PG18 lane must be confirmed**, and `EXPECTED_RED` is not yet *deleted* (it stays as a ledger until cutover). |
| 2 | **Differential: zero untriaged divergences** | `bun test tests/differential.test.ts` — every `accepted-difference` has a reason + appears in the migration guide; every `old-bug` has a corpus scenario | Differential is clean (44/0 new-engine regressions at last run). The **accepted-difference list → migration-guide** wiring does not exist yet (no migration guide). |
| 3 | **Generative soak at the agreed quota**, zero proof failures/cycles/crashes, **generator kind-coverage checklist complete** | `PGDELTA_NEXT_SOAK=<quota> bun test tests/generative.test.ts` | **Quota is still TBD** (the canonical plan suggests a sustained CI-week at ≥10k schemas). The generator's per-kind coverage checklist needs an explicit "complete" sign-off — a soak from a narrow generator satisfies nothing. |
| 4 | **Extractor ring green on all PG versions**; `COVERAGE.md` has no untriaged gaps; pg_dump observer green | `bun test tests/` extractor suites per PG version | Green PG15+17; `COVERAGE.md` records the deliberate exclusions. Confirm PG18; confirm the pg_dump observer lane. |
| 5 | **Performance ≥ old engine** on extract/diff/plan; numbers published | `bun scripts/benchmark.ts` (in CI since stage 5) on the 10k-object fixture | Benchmark harness exists and runs in CI; **publishing a head-to-head old-vs-new table is the missing step**. (See [`tier-3-extract-depends-perf.md`](tier-3-extract-depends-perf.md) for the one known tuning lever.) |
| 6 | **Real-world shakedown** — Supabase policy scenarios on current production image tags + ≥1 large anonymized real schema through plan+prove | Run the Supabase policy e2e suite on pinned production tags; run one large dump through `plan` + `prove` | Supabase policy substrate exists; the **large-real-schema shakedown has not been run** and the production-tag matrix needs pinning. |

## Product decisions to record (not engineering)

- **Naming**: new major of `@supabase/pg-delta` vs a new package name. Either
  way the old library's deprecation banner lands *after* cutover.
- **Maintenance window** for the old library (duration; no new object-kind
  support after cutover — new PG versions are the new library's job).
- **Migration guide ownership + reviewer** — must be reviewed by someone who did
  **not** build the engine.

## Pitfalls (from the canonical plan)

- **Consumer surprise area #1 is output shape**, not the API. Decomposed-by-
  default + compaction make the SQL *look* different. The accepted-differences
  list and compaction defaults deserve **more** migration-guide space than the
  API mapping — programmatic consumers adapt signatures quickly; humans
  reviewing unfamiliar SQL lose trust slowly.
- **Do not delete the old engine at cutover.** It stays as the differential
  oracle in CI until the maintenance window closes — divergences found by
  *users* post-cutover still need it for adjudication.
- **The bar is a conjunction.** Pressure will exist to cut over at "corpus
  green, soak mostly done." Don't.

## Gate

The parity bar, verified in a **single CI run whose summary is attached to the
cutover PR**, plus the migration guide reviewed by an outsider to the engine.

## Why this is Tier 2, not Tier 1

Nothing here is a unilateral engineering decision. The engineering is done; what
remains is **evidence-gathering** (run the matrices, publish the numbers, run
the shakedown) and **product calls** (naming, window, guide). Sequence it
**after** the Tier 3 productization layer is built, so the thing being cut over
is the full product, not just the engine.
