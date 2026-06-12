# Stage 3: Proof Harness + Live Corpus

> Part of the [north-star architecture](./target-architecture.md) (§3.7, §4.3).
> Depends on: stages 0–2. Guardrail 5: this stage lands **before** stage 5
> (planner) starts. Gate: the harness proves extract → materialize →
> re-extract fidelity over the corpus.

## Goal

Turn the stage-0 test scaffold into the live oracle: `provePlan`, the
data-preservation check, and the differential runner. After this stage, the
project has its safety net — every later stage is judged by machinery built
here, not by human review of SQL.

## Deliverables

1. **`provePlan(plan, sourceFactBase | sourcePool, desiredFactBase)`**:
   materialize source → apply plan → extract → hash-compare against desired.
   Returns a structured verdict (state diff if any, data-preservation
   violations, observed rewrites).
2. **Materialization, two forms** (§3.7):
   - *Template clone* — `CREATE DATABASE … TEMPLATE` of a scratch source.
     Works for everything CI does; requires the source to have no other
     connections (the harness owns its containers, so it can guarantee
     that).
   - *Render-from-fact-base* — **deferred to stage 5/6**, because rendering
     a fact base to DDL *is* the planner (`plan(∅ → fb)` applied to an
     empty database). Stub it now with a clear error; wire it the moment
     stage 5 can render creates. The stage-3 fidelity gate uses template
     clones and snapshot round-trips only. Record this sequencing in the
     code comment so nobody "fixes" the stub early.
3. **Data-preservation check.** After materializing the source and before
   applying the plan: run the scenario's `seed.sql` if present; otherwise
   auto-seed — insert a small synthetic row into every insertable user
   table (respecting NOT NULL/FK order by inserting in dependency order;
   skip tables that can't be satisfied generically and record the skip).
   After apply: every seeded row must survive (count + content sample) in
   every table the plan did not declare data loss for. Violations fail the
   proof with the offending table named.
4. **Rewrite observation.** Record `pg_class.relfilenode` for user tables
   before/after apply on the clone; a changed relfilenode under an action
   that claimed no rewrite fails the proof (§3.7).
5. **The differential runner.** Per scenario: old engine plans and applies
   `A → B` on its own clone pair; new engine (once it exists) does the
   same; both results extracted **with the new extractor** and
   hash-compared. Until stage 5, the runner records old-engine results only
   (upgrading the stage-0 pg_dump baselines to fact-base baselines).
   Divergences land in a triage file with three buckets: `new-bug`,
   `old-bug`, `accepted-difference` — every entry needs a one-line reason.
6. **Generative scaffolding (minimal).** The harness API for
   property-based runs: `roundtrip(generatorSeed)` — generate a schema,
   prove `plan(∅ → S)` then `plan(S → S′)` for a mutated S′. Ship with a
   trivial generator (a few kinds); growing the generator is continuous
   background work from here on, not a one-time deliverable.

## How to proceed

1. Template-clone materialization + extract-fidelity first: for each
   corpus scenario, build A, clone it, extract both, assert hash-identical.
   This validates extractor determinism and the clone path with zero
   planner involvement — and it's the stage gate.
2. Snapshot fidelity: extract → serialize → deserialize → re-compare.
3. Data-preservation mechanics against hand-built plans (literal SQL plans
   written for the test — the harness shouldn't wait for the planner to
   verify its own checks work). Include a deliberately destructive plan to
   prove the check *fails* correctly.
4. Rewrite observation, same approach: a hand-built `ALTER COLUMN TYPE`
   plan must trip it; an `ADD COLUMN` must not.
5. Differential runner recording old-engine fact-base baselines.
6. Flip the stage-0 `EXPECTED_RED` entries for harness-infrastructure
   tests; engine scenarios stay red.

## What to look for (pitfalls)

- **Harness bugs are invisible later.** A proof loop that vacuously passes
  is worse than none. Every check needs its negative test (the
  deliberately-broken plan that must fail) — treat the harness itself as
  TDD subject.
- **Auto-seed fragility.** Generic row synthesis hits exotic column types,
  generated columns, and partitioned tables. Keep the skip-list explicit
  and visible in proof output; a scenario where nothing could be seeded
  proves nothing about data preservation and should say so.
- **Clone cost.** Template clones are file copies — cheap, but per-scenario
  × per-PG-version adds up. Reuse the stage-0 container pool; one container
  per PG version, databases as the isolation unit (the old suite's model,
  which is the right one).
- **Old-engine quirks in the differential.** The old engine's plans
  sometimes include session `SET` statements; normalize before applying,
  don't diff statement lists — only resulting fact bases.

## Gate

- Extract → clone → re-extract hash-identical across the corpus, all PG
  versions.
- Snapshot round-trip fidelity across the corpus.
- Data-preservation and rewrite checks each demonstrated with negative
  tests.
- Old-engine fact-base baselines recorded for the corpus.
- Generative scaffold runs end-to-end with the trivial generator (proof of
  plumbing, not coverage).

## Open decisions for this stage

- Auto-seed strategy details (how hard to try on FK graphs before
  skipping).
- Corpus-pruning policy stays open (architecture doc §11) — revisit once
  generative coverage exists.
