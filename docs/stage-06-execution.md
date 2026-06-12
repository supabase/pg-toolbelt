# Stage 6: Execution + Plan Artifact v1

> Part of the [north-star architecture](./target-architecture.md) (§3.7–3.8).
> Depends on: stage 5. Gate: end-to-end proof on the corpus including
> segmented non-transactional actions.

## Goal

Plans become durable artifacts and applies become lock-aware, segmented,
attributable executions. Also closes the stage-3 stub: render-from-fact-base
materialization (`plan(∅ → fb)` applied to an empty scratch) now works,
enabling proof against live sources.

## Deliverables

1. **Plan artifact v1** (version-tagged JSON):
   `{formatVersion: 1, engineVersion, source: {fingerprint}, target:
   {fingerprint}, deltas: [...], actions: [{sql, produces, consumes,
   destroys, lockClass, rewriteRisk, dataLoss, transactional}],
   safetyReport, policyId?}`. Fingerprints are fact-base rollup digests
   (stage 1). Round-trips losslessly; `apply` accepts the artifact, never
   a bare SQL list.
2. **Segmented executor.** Transactionality is three-valued, declared per
   action by the rule table:
   - `transactional` — the default; grouped into maximal transaction runs.
   - `nonTransactional` — cannot run inside a transaction block at all:
     `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`,
     `ALTER TABLE … DETACH PARTITION CONCURRENTLY`, `ALTER SYSTEM`,
     `CREATE`/`DROP DATABASE`/`TABLESPACE`, subscription operations that
     create/drop replication slots. Executed alone, between transaction
     segments.
   - `commitBoundaryAfter` — *runs* in a transaction but its effect is not
     usable until commit: the canonical case is `ALTER TYPE … ADD VALUE`,
     whose new enum value cannot be referenced later in the same
     transaction. The executor forces a segment boundary between the
     action and any consumer of what it produced (the dependency edges
     already say who consumes it).

   Segmentation changes **transaction boundaries only, never order** — the
   topological order is global across segments. Failure semantics are
   explicit: on mid-plan failure, report exactly which actions are
   applied/unapplied/in-doubt. Per-statement error attribution (statement,
   action, underlying PG error) — no joined-string megaqueries. Executor
   *options* (operational policy, not safety metadata): per-segment
   `lock_timeout` / `statement_timeout`, and optional
   retry-on-lock-timeout for actions whose declared lock class is
   contention-prone.
3. **Fingerprint gate on apply**: source fingerprint must match the live
   target's current fact-base digest (re-extract before apply);
   `--force`-style override is a CLI concern, not a library default.
   Post-apply verification is `provePlan`'s job and is **opt-in**.
4. **Render-from-fact-base materialization** wired into the harness
   (replaces the stage-3 stub); the §3.7 live-source proof path is now
   real. Add corpus runs that prove via this path to catch render gaps.
5. **Session preamble** as explicit plan metadata (e.g.
   `check_function_bodies = off`), not loose SQL statements mixed into the
   action list.

## How to proceed

1. Artifact schema + round-trip tests (pure).
2. Executor against hand-built plans with deliberate mid-plan failures —
   assert the applied/unapplied/in-doubt report before wiring real plans.
3. Transactionality metadata: seed the static table from PostgreSQL docs
   (which DDL cannot run in a transaction block); every entry needs a
   corpus or unit scenario exercising it.
4. Wire `apply` + fingerprint gate; flip the remaining harness paths to
   consume artifacts.
5. Render-from-fact-base: implement as `plan(emptyFactBase, fb)` through
   the stage-5 planner; the fidelity gate is extract → render-materialize →
   re-extract hash-identical across the corpus (this also doubles as a
   brutal planner test — every extractable state must be constructible).

## What to look for (pitfalls)

- **The in-doubt window.** A failure between segments leaves a partially
  applied plan; the report must distinguish it from a clean rollback.
  Resumability (re-plan from current state) is the answer — document it;
  don't build resume-from-statement bookkeeping.
- **Render-materialization completeness** will lag (some states require
  context the planner doesn't render yet — e.g. role passwords extract as
  hashes). Maintain an explicit skip-list surfaced in proof output, same
  policy as auto-seed skips.
- **Lock-class honesty**: the executor doesn't *enforce* lock claims; it
  reports them. Verification is stage-3's relfilenode check plus the vetted
  static table (§3.7) — resist inventing runtime lock introspection here.

## Gate

- Corpus green end-to-end through artifacts (plan → serialize →
  deserialize → apply → prove).
- Segmentation demonstrated: corpus includes at least one
  `CREATE INDEX CONCURRENTLY` scenario applying correctly.
- Mid-plan failure reporting covered by negative tests.
- Render-from-fact-base fidelity green across the corpus (modulo the
  explicit skip-list).
