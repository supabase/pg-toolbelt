# Stage 10: Cutover at the Parity Bar

> Part of the [north-star architecture](./target-architecture.md) (§9).
> Depends on: everything. Gate: the parity bar itself.

## Goal

The switch: the new library becomes the product, the old one enters
maintenance. This stage is mostly verification and product mechanics — if
earlier gates held, there is no engineering cliff here, only evidence
gathering and a decision.

## The parity bar (all simultaneously true)

1. **Corpus**: 100% green — proof (state + data preservation) across all
   supported PG versions; `EXPECTED_RED` is empty and deleted.
2. **Differential**: zero untriaged divergences; every `accepted-difference`
   has a reason and appears in the migration guide; every `old-bug` has a
   corpus scenario.
3. **Generative soak**: the agreed quota (set it now — e.g. a sustained
   CI-week of roundtrips at ≥10k schemas) with zero proof failures, zero
   cycles, zero crashes — **and the generator's kind-coverage checklist
   complete** (stage 5 grew it per kind-batch PR); a soak from a
   three-kind generator satisfies nothing.
4. **Extractor ring**: green on all supported PG versions; `COVERAGE.md`
   per kind has no untriaged gaps; pg_dump observer green.
5. **Performance**: the benchmark fixture and timing harness (built in
   stage 5, running in CI since) show the new engine ≥ old engine on
   extract, diff, plan wall-time; publish the numbers.
6. **Real-world shakedown**: the Supabase policy scenarios against current
   production image tags, plus at least one large real schema (anonymized
   dump) through plan + prove.

## Product mechanics

- **Naming**: new major of `@supabase/pg-delta` vs a new package name —
  product decision recorded in the architecture doc's decision log when
  made. Either way: the old library's final minor gets a README banner and
  a `@deprecated` pointer after cutover, not before.
- **Maintenance policy for the old library**: security and
  critical-correctness fixes only, for a stated window; no new object-kind
  support after cutover (new PG versions are the new library's job).
- **Migration guide** (write from the artifacts already accumulated):
  API mapping (old call → new call), plan-artifact format differences,
  output-shape changes (decomposed-by-default + compaction; the
  accepted-differences list), policy DSL v1 → v2 cookbook (the stage-8
  mapping table), snapshot regeneration instructions.
- **Repo mechanics**: the new package leaves its `pg-delta-next`
  placeholder name; CI matrices consolidate (the corpus suite replaces the
  45-job matrix as the primary gate; the old suite keeps running only as
  long as the old library is maintained); changesets configured for the
  new package's release line.

## What to look for (pitfalls)

- **The bar is a conjunction.** Pressure will exist to cut over at "corpus
  green, soak mostly done." The bar is cheap to state and expensive to
  regret; hold it (guardrail 7).
- **Consumer surprise area #1 is output shape.** The accepted-differences
  list and the compaction defaults deserve more migration-guide space than
  the API mapping — programmatic consumers adapt signatures quickly; humans
  reviewing unfamiliar-looking SQL lose trust slowly.
- **Don't delete the old engine at cutover.** It stays as the differential
  oracle in CI until the maintenance window closes — divergences found by
  *users* post-cutover still need it for adjudication.

## Gate

The parity bar, verified in a single CI run whose summary is attached to
the cutover PR, plus the migration guide reviewed by someone who didn't
build the engine.
