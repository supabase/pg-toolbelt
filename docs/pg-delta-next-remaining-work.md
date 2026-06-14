# pg-delta-next: the road to a correctness-first v1

- **Date**: 2026-06-14
- **Branch**: `feat/pg-delta-next`
- **Strategy**: cut **v1 on correctness** — a trustworthy engine, proven at
  scale, honest about what it manages. **Performance and DX come after** (two
  later milestones). This doc is the one-page roadmap; per-item detail lives
  under [`remaining-work/`](remaining-work/).

## Baseline — what is already done and proven

- **Engine code-complete (stages 0–9)** — identity codec + fact base, snapshot
  extraction, generic diff, the rule-table planner (one graph, deterministic
  sort, compaction), the proof loop (state + data-preservation + rewrite
  observation), shadow-DB / snapshot frontends, policy DSL v2 + Supabase package,
  renames + export + drift, the reviewed public API (`API-REVIEW.md`) + CLI.
- **Hardening plan** (8 items) and **4b** (extension-member provenance flip)
  shipped; **security-label** proven end-to-end.
- **The managed-view architecture** ([managed-view-architecture.md](managed-view-architecture.md))
  shipped — moves 1–7 + follow-ups: `skipSchema`/`skipAuthorization` eliminated
  (derived from catalog facts), **ownership is an edge**, scope filtering is a
  fact-level **view** (proof-honest), and **applier capability** restricts the
  view (FDW-ACL projection + owner-residue fail-fast).
- **The validation harness is in CI and green** ([.github/workflows/pg-delta-next.yml](../.github/workflows/pg-delta-next.yml)):
  - corpus **211 scenarios × 2 directions** under the full proof loop, on **PG
    15, 17 AND 18**, `EXPECTED_RED` **empty**;
  - a **differential** harness (new engine vs the old `pg-delta`) with a hard
    regression gate (`new-fails-old-converges` = error) + a triage ledger;
  - a **generative soak** with an enforced kind-coverage checklist;
  - the **benchmark** harness (informational).

**So the engine and its correctness machinery are essentially v1-ready.** What
remains for a v1 cut is one real gap + running the gates to green at scale +
publishing the scope.

---

## What blocks a correctness-first v1

### 1. 🟠 Engineering — loud detection of unmodeled object kinds (the one real gap)

The engine **silently omits** user-created objects in kinds it doesn't model
(CAST, operator class/family, text-search config, statistics object, user-defined
language, transform): they never become facts, never diff, and the user is never
told. A migration tool that silently misses schema is not trustworthy.

**Optimal fix (correctness floor, not feature-completeness):** a provenance-aware
**catalog completeness check** at extract — every object in a managed namespace
is either modeled (a fact) **or reported** (an `unmodeled_kind` diagnostic), with
an opt-in **strict mode** that refuses to plan while unmanaged user objects exist.
v1 need not *model* these kinds (post-v1, demand-driven) — only never *silently
miss* them. Full design + steps: **[v1-unmodeled-kind-detection.md](remaining-work/v1-unmodeled-kind-detection.md)**.

### 2. 🟢 Validation — run the gates to green *at scale* (evidence, not new engine code)

The harness exists and is green at CI defaults; cutting v1 means recording it
green at the agreed scale:

- **Full differential** (`PGDELTA_NEXT_DIFFERENTIAL=all`) run + triaged: zero
  untriaged `new-fails-old-converges`; every `accepted-difference` has a reason.
- **Generative soak at the agreed quota** (raise `PGDELTA_NEXT_SOAK` to a
  sustained run — set the quota now) with zero proof failures / cycles / crashes.
- **Real-world shakedown** — at least one large anonymized production-shaped
  schema through `plan` + `prove`.
- **Commit the Supabase baseline snapshot** so baseline subtraction is *exercised
  in CI*, not just generatable (`src/policy/baselines/` is `.gitkeep` only today —
  see [service-migration-baselines](remaining-work/tier-3-service-migration-baselines.md)).

### 3. 🟢 Docs — publish the v1 scope statement

A user-facing statement of **what v1 manages and what it deliberately doesn't**
(derived from `COVERAGE.md` + the new completeness diagnostic). With item 1
shipped, the exclusions are enforced + visible; this writes them down for users.

> **Not a v1 gate:** "performance ≥ the old engine." v1 is correctness-first and
> may still trail the old engine on speed — that's the next milestone. The
> stage-10 parity bar's *correctness* conditions (corpus, differential, soak,
> extractor ring, shakedown) gate v1; its *performance* condition does not.

---

## Post-v1 milestone A — performance

Deferred deliberately. See [extractDepends perf](remaining-work/tier-3-extract-depends-perf.md)
and `target-architecture.md` §3.2.

- **Parallel snapshot extraction** (`pg_export_snapshot()` workers) — the biggest
  win; capture is serial today (correct, not yet fast).
- **`extractDepends` latency tuning** on very large catalogs (statement-timeout
  budget, the "family queries returning `jsonb_agg`" direction — never one mega
  query).
- **Publish the benchmark** ≥ the old engine on extract / diff / plan.

## Post-v1 milestone B — DX & cutover

The user-facing surface over the ready engine. Detail in [`remaining-work/`](remaining-work/).

- **CLI / productization**: [risk classification 2.0](remaining-work/tier-3-risk-classification.md),
  [migration squash / repair](remaining-work/tier-3-migration-squash-repair.md),
  [object-filtering flags](remaining-work/tier-3-object-filtering-flags.md),
  [typed auth errors](remaining-work/tier-3-typed-auth-errors.md),
  [Stripe reset](remaining-work/tier-3-stripe-sync-engine-reset.md), and
  finishing the **applier-capability CLI wiring** (the persistence is shipped;
  `plan --restrict-to-applier` exists — extend to the rest of the flow).
- **Extension-intent Phase B** (feature): replay `pgmq.create` / `cron.schedule` /
  `partman.create_parent` on a from-scratch rebuild — blocked on the CLI-1431
  declarative-format decision. Phase A (no data loss) already ships.
  [tier-1-extension-intent-phase-b.md](remaining-work/tier-1-extension-intent-phase-b.md).
- **Stage-10 cutover** product mechanics (naming, deprecation banner, migration
  guide) once v1 + the perf milestone land.
  [tier-2-stage-10-cutover.md](remaining-work/tier-2-stage-10-cutover.md).

## Deliberate deferrals (not blocking any milestone)

Recorded in `COVERAGE.md` / `target-architecture.md` §7 — see
[tier-4-deferrals.md](remaining-work/tier-4-deferrals.md). 4b's deferred
extractor families; **modeling** specific not-modeled kinds (now *detected +
reported* by item 1 — model them when a real schema needs it); the security-label
CI prebuild; PGlite in the trusted path.

---

## Recommended order to cut v1

1. **Ship unmodeled-kind detection** (item 1) — the only correctness gap; small,
   additive, the floor for a trustworthy v1.
2. **Run the validation gates to green at scale** (item 2) — full differential,
   the soak quota, a real-world shakedown; commit the Supabase baseline.
3. **Publish the v1 scope statement** (item 3) → **cut v1.**
4. Then **performance** (milestone A), then **DX + cutover** (milestone B).
