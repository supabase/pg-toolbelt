# Stage 0: The Red Test Suite (corpus first)

> Part of the [north-star architecture](./target-architecture.md) (§4.3, §9).
> Read §10 (guardrails) before starting. Depends on: nothing — this is the
> first thing built. Everything else depends on it.

## Goal

Stand up the **entire test architecture before any engine code exists**: the
scenario corpus ported from the current integration suite, the proof-harness
contract, and the differential baselines. Engine tests are red — by design —
until stages 4–6 land. This inverts the usual order on purpose: the corpus
is the distilled record of every field-discovered failure (the second most
valuable asset after the extractor SQL), and writing it first means every
subsequent stage lands against a pre-existing definition of done.

**The red/green discipline that makes "all red" sound:**

| Layer | State at end of stage 0 | What it proves |
|---|---|---|
| Fixture validity | **Green** | Every scenario's DDL applies cleanly on every supported PG version — the corpus itself is correct |
| Old-engine baselines | **Green** | The current pg-delta produces a recorded plan/outcome per scenario — the differential oracle has data |
| Engine tests (proof loop) | **Red on `NotImplementedError`** | Red for the *right reason* — the harness asserts the failure mode, so a fixture bug cannot masquerade as "engine missing" |

## Deliverables

1. **New package skeleton** — working directory `packages/pg-delta-next/`
   (the name is a placeholder; final naming is a stage-10 product decision).
   Contains only: the target public API as typed stubs that throw
   `NotImplementedError` (`extractFactBase`, `diff`, `plan`, `provePlan`,
   `apply`, `loadSqlFiles` — signatures from the architecture doc §3), the
   corpus, and the test suite.
2. **Corpus format.** One directory per scenario:

   ```text
   packages/pg-delta-next/corpus/<category>/<scenario-name>/
   ├── a.sql            # DDL for the source state
   ├── b.sql            # DDL for the desired state
   ├── seed.sql         # optional: rows to seed for the data-preservation check
   └── meta.ts          # name, description, tags, plan assertions
   ```

   `meta.ts` exports a typed object:

   ```ts
   export default defineScenario({
     description: "publication drops column on surviving table",
     tags: ["publication", "pg15", "pg17", "pg18"],     // pg tags drive the matrix
     requires: [],                                       // e.g. ["logical-wal", "supabase-image", "isolated-cluster"]
     expect: {                                           // semantic plan assertions — NEVER SQL bytes
       dataLoss: "none",                                 // drives the seeded-rows proof
       actions: [{ kind: "column", verb: "remove", via: "alter" }],  // optional, only where load-bearing
       maxActions: 12,                                   // optional minimality budget
     },
   });
   ```

3. **Fixture-validity suite (green).** For every scenario × PG version:
   apply `a.sql` to a fresh database, apply `b.sql` to another, fail on any
   SQL error. Reuses the existing container infrastructure
   (`packages/pg-delta/tests/container-manager.ts` — import it or copy it;
   copying is fine, this package owns its destiny).
4. **Engine suite (red).** For every scenario: the proof-loop test
   (`plan → provePlan → assertions from meta.ts`) written against the stub
   API. Each test asserts it fails with `NotImplementedError` *until* a
   stage flips it: maintain an explicit `EXPECTED_RED` list in one file so
   turning a scenario green is a deliberate one-line diff, and an
   accidentally-green test is a failure.
5. **Differential baseline capture (green).** A script (not a test) that
   runs the *current* `@supabase/pg-delta` `createPlan` over every scenario
   and records: the statement list, apply success/failure, and the resulting
   schema (via `pg_dump --schema-only` for now — the new extractor doesn't
   exist yet). Stored under `corpus-baselines/` (gitignored size permitting,
   or regenerated in CI). Stage 3 upgrades this into the live differential
   runner.

## How to proceed

1. Scaffold the package (tsconfig, bun test wiring, container manager).
   Define the stub API and `NotImplementedError`.
2. **Port the corpus.** Enumerate `packages/pg-delta/tests/integration/*.test.ts`
   (63 files). For each test case, extract the `(main DDL, branch DDL)` pair
   from the `withDb`/`withDbIsolated` callbacks and the
   `roundtripFidelityTest` invocations into `a.sql`/`b.sql`. Keep a
   `PORTING.md` checklist mapping every original test file → scenario
   directories, so coverage is auditable (the stage gate counts this).
3. While porting, translate — don't transcribe — the assertions:
   - Inline SQL snapshots: identify what the snapshot was actually guarding
     (an ALTER instead of drop+create? ordering? a specific clause?) and
     express that as `expect.actions` / `expect.dataLoss` / `maxActions`.
     Most snapshots guard nothing beyond convergence — omit `expect` then.
   - Tests asserting planner internals: usually corpus-irrelevant; note
     them in `PORTING.md` as "not ported — mechanism test".
4. Tag scenarios honestly: `requires: ["supabase-image"]` for the Supabase
   suite (they need the base-init baseline — port those last),
   `["logical-wal"]` for subscription tests, `["isolated-cluster"]` for
   role/shared-object scenarios, per-PG tags where behavior is
   version-specific.
5. Wire CI: fixture-validity + baseline capture run on the matrix; engine
   suite runs but is satisfied by `EXPECTED_RED`.

## What to look for (pitfalls)

- **Scenarios that encode old-engine quirks.** Some tests assert behavior
  the north star intentionally changes (e.g. exact emission shape, the
  `invalidates` mechanics). Port the *scenario*, drop the *assertion*; the
  proof loop is the new assertion.
- **Setup that hides in test utils.** `withDbSupabaseIsolated` replays the
  base-init fixture; scenarios extracted from those tests are incomplete
  without the `supabase-image` requirement.
- **Multi-step tests.** A few tests apply, mutate, re-plan. Those become
  *two* scenarios (or a scenario chain — keep it simple: split them).
- **Version-gated DDL.** PG18-only syntax in a scenario tagged for pg15
  shows up immediately in fixture validity — that's the layer working.
- **Don't fix old-engine bugs in the corpus.** If porting reveals a case
  where the current engine seems wrong, port it as-is and add a
  `suspectedOldEngineBug` note in `meta.ts`; the differential triage in
  stage 5 adjudicates.

## Gate (definition of done)

- `PORTING.md` accounts for 100% of the existing integration test files
  (ported / split / not-ported-with-reason).
- Fixture validity green on PG 15, 17, 18.
- Old-engine baselines captured for every scenario the old engine supports.
- Engine suite red, with every red accounted for in `EXPECTED_RED`.
- The corpus has scenarios covering: every cycle-breaker case
  (`cycle-breakers.ts` patterns), every post-diff-normalization case, the
  Supabase baseline flow, and at least one scenario per object kind.

## Open decisions for this stage

- Scenario directory taxonomy (`<category>/` grouping) — pick what reads
  well after ~20 ports, then stick to it.
- Whether baselines are committed or CI-regenerated (size-driven).
