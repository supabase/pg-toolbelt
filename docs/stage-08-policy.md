# Stage 8: Policy Layer (DSL v2 + Supabase package)

> Part of the [north-star architecture](./target-architecture.md) (§3.9).
> Depends on: stages 4–6 (deltas and plans exist). Gate: policy scenarios;
> baseline-subtraction proof against a real platform image.

## Goal

Vendor behavior as data: filtering (which deltas a user sees), serialization
parameters (how actions render), and platform baselines (what "empty" means
on a managed platform). Designed fresh for facts/deltas — the old DSL's
pattern syntax is not carried (decision log f); its evaluation model
(declarative rules, first-match-wins) is.

## Deliverables

1. **DSL v2.** Typed predicates over: fact kind, identity fields (schema,
   name — with glob/regex matchers), delta verb, provenance (edge
   predicates: `memberOfExtension`, ownership), and parent context.
   Combinators: `all` / `any` / `not`. A policy =
   `{filter?: Rule[], serialize?: Rule[], baseline?: SnapshotRef,
   extends?: PolicyRef[]}` — rules first-match-wins, `extends` composition
   with cycle detection (port the semantics, not the code, from the old
   `integration-dsl.ts`).
2. **Filter semantics**: filtering removes *deltas* before planning — the
   engine extracted everything (stage 2's no-filter doctrine); policy
   decides visibility. Filtered deltas are reported (counted, listable),
   never silently absent — drift the user chose not to manage is still
   drift they can ask about.
3. **Serialize parameterization**: named parameters consumed by rule
   templates (the `skipAuthorization` class of options). Parameters are
   declared by the rule table (stage 5) so a policy referencing an unknown
   parameter is a compile error, not a silent no-op.
4. **Baseline subtraction**: `applyBaseline(fb, baselineSnapshot)` — facts
   present-and-identical in the baseline are dropped from both sides before
   diffing. The baseline is a stage-1 snapshot, version-tagged, regenerated
   by script — port the *workflow* of the old
   `packages/pg-delta/scripts/sync-supabase-base-images.ts` (bare image vs
   fully-provisioned instance, extract, save) and mine
   `update-empty-catalog-baseline.ts` for the empty-catalog baseline this
   mechanism replaces.
5. **The Supabase policy package** — the first consumer and the proof the
   DSL suffices: port every rule from the old `supabase.ts` (schema/role
   exclusion lists, skip-authorization rules, extension suppression) into
   DSL v2, plus the platform baseline snapshot per supported PG version.
   Maintain a mapping table old-rule → new-rule in the package so reviewers
   can audit completeness.
6. **Corpus additions**: policy scenarios — managed-schema changes
   invisible under the Supabase policy but visible without it; provenance
   filtering (extension-owned objects); baseline subtraction proven against
   the real Supabase image (extract image, apply baseline, plan against a
   user schema, prove).

## What to look for (pitfalls)

- **Predicate power creep.** If a Supabase rule can't be expressed, extend
  the predicate vocabulary deliberately (and log it) — do not add a
  function-valued escape hatch to the DSL; policies must stay serializable
  data (they ship inside plan artifacts as `policyId` + inline policy for
  reproducibility).
- **Filtering vs correctness.** A filtered delta can be a dependency of an
  unfiltered action (user table referencing a filtered-out role). The
  *check* for this already exists — stage 5's graph build fails loudly on
  any missing requirement (its deliverable 6); this stage's job is the
  policy-shaped negative test and the user-facing message ("your filter
  excludes role X required by table Y"), not a new mechanism.
- **Baseline drift.** Platform images change; a stale baseline shows up as
  phantom deltas. The baseline snapshot embeds the image tag it came from;
  the policy scenario in CI regenerates against the pinned tag so drift is
  caught when the pin moves, not in production.

## Gate

- DSL v2 unit suite (predicates, composition, first-match-wins, extends
  cycles).
- Supabase policy package: mapping table complete; policy scenarios green,
  including the real-image baseline-subtraction proof.
- Dangling-requirement detection covered by a negative test.
