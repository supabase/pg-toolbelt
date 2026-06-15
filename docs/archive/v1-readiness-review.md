# pg-delta-next v1 Readiness Review

## Scope

This is a read-only architecture and implementation review of
`feat/pg-delta-next` as of commit `0a42e67a2f52344afb00acaef14d8b9142980355`.

The current worktree used to write this document was detached at a different
commit, so path and line references below refer to the reviewed branch snapshot,
not necessarily to the checkout this file was authored from.

The question reviewed here is narrow:

> What remains before pg-delta-next can be called v1 complete on correctness?

I did not run the Docker matrix while preparing this review. The findings are
from reading the design docs, remaining-work docs, implementation, test harness,
and CI workflow.

## Executive Summary

The engine is close. The core architecture now matches the design much better
than in the earlier review:

- `resolveView(...)` defines the managed fact view before diffing.
- Extension members are projected out by default where provenance is observed.
- `projectTarget(...)` makes filtered deltas part of the honest proof target.
- Proof now reports coverage and content modes instead of pretending row counts
  are full data proof.
- Owner is modeled as an edge.
- Applier capability is represented explicitly.
- Enum commit boundaries and SQL-file loader atomicity were hardened.
- The planner split was conservative and mostly improves locality without
  fragmenting the algorithm.

However, I would **not** declare v1 correctness-complete yet.

There is still one true correctness blocker:

1. User-created objects in unmodeled catalog kinds are still silently omitted.

There are also several v1 readiness gaps:

2. Extraction diagnostics are not consistently surfaced by CLI/frontends.
3. `Policy.baseline` is currently inert unless a caller manually applies
   subtraction.
4. The 4b provenance flip is partial and should be documented as such wherever
   v1 status is summarized.
5. The evidence gates exist, but the final v1-scale run and recorded evidence
   are still needed.

Extension-intent Phase B, performance parity, and a deeper planner refactor
should remain post-v1 unless the product promise changes.

## V1 Recommendation

Do not declare v1 until all P0 items below are done and the evidence gates are
recorded.

I would define the v1 correctness bar as:

1. The engine either models every user-created schema object in a managed scope
   or emits a diagnostic that names the unsupported kind.
2. CLI/frontends surface those diagnostics by default.
3. Strict coverage mode can fail planning/proof before producing a misleading
   plan.
4. The policy/view/proof path is exercised by the final corpus, differential,
   generative, and real-world shakedown gates.
5. The v1 scope statement matches the implementation exactly, including
   deliberate exclusions.

## Finding 1: P0 — Unmodeled-Kind Detection Is Still Missing

### Evidence

The roadmap correctly identifies this as the one real v1 correctness blocker:

- `docs/pg-delta-next-remaining-work.md` says the engine silently omits
  user-created objects in kinds it does not model.
- `docs/remaining-work/v1-unmodeled-kind-detection.md` gives the right design:
  catalog completeness check, warning by default, strict mode as an opt-in.

The implementation has no `unmodeled_kind` diagnostic, no strict coverage option,
and no completeness pass. The extractor still treats some unrecognized
`pg_depend` endpoints as "built-in / unmodeled" and skips them quietly:

- `packages/pg-delta-next/src/extract/extract.ts:1797`

`COVERAGE.md` documents deliberate non-modeled kinds, but that documentation is
not enforced against the live catalog:

- user casts
- operators
- operator classes/families
- text-search configs/dictionaries/parsers/templates
- statistics objects
- user-defined languages
- transforms

### Why This Blocks V1

The proof loop reads both source and desired through the same extractor. If the
extractor is blind to a user object, the proof loop can pass vacuously. This is
exactly the risk called out in `target-architecture.md`: extractor blind spots
need an independent defense.

For v1, the engine does not need to model every PostgreSQL object kind. But it
must never silently miss user state.

### Technically Optimal Shape

Add an extraction completeness Module:

```text
packages/pg-delta-next/src/extract/unmodeled.ts
```

Its Interface should be small:

```ts
export interface UnmodeledKindDiagnostic {
  code: "unmodeled_kind";
  severity: "warning";
  kind: string;
  count: number;
  samples: string[];
}

export async function detectUnmodeledKinds(
  client: PoolClient,
): Promise<Diagnostic[]>;
```

The Module should run after modeled extraction, append diagnostics to
`ExtractResult.diagnostics`, and be provenance-aware:

- exclude `pg_catalog`, `information_schema`, temp, and toast objects;
- exclude extension-owned objects through `pg_depend.deptype = 'e'`;
- report user-created objects in managed schemas;
- include count and a small deterministic sample list per kind.

This belongs at the extraction seam, not inside `plan(source: FactBase,
desired: FactBase)`. Once only a `FactBase` reaches `plan()`, the catalog
objects that were not extracted are already lost.

### Suggested Probe Set

Implement bounded, per-kind probes rather than one mega-query:

- `pg_cast`: source or target type in a user namespace, not extension-owned.
- `pg_operator`: `oprnamespace` in a user namespace, not extension-owned.
- `pg_opclass` / `pg_opfamily`: namespace in user scope, not extension-owned.
- `pg_ts_config`, `pg_ts_dict`, `pg_ts_parser`, `pg_ts_template`: namespace in
  user scope, not extension-owned.
- `pg_statistic_ext`: `stxnamespace` in user scope.
- `pg_language`: user-defined/procedural languages other than built-ins
  (`sql`, `plpgsql`, `c`, `internal`), not extension-owned.
- `pg_transform`: type or language in user scope, not extension-owned.

Large objects should probably remain out of strict schema coverage unless the
product wants a separate data-state warning. They are not schema DDL in the same
sense as casts/operators/statistics.

### Strict Mode

Default behavior:

- emit `warning` diagnostics;
- surface them in CLI output;
- still allow planning.

Strict behavior:

- fail before planning if any `unmodeled_kind` diagnostic is present.

The cleanest Interface is either:

```ts
extract(pool, { coverage: { unmodeled: "warn" | "error" | "ignore" } })
```

or:

```ts
assertNoBlockingDiagnostics(extractResult.diagnostics, {
  unmodeled: "error",
});
```

I would keep the pure `plan(FactBase, FactBase)` Interface unchanged and enforce
strict coverage at the extraction/frontends seam.

### Tests

Add RED tests before implementation:

- Integration: create a user-defined cast and text-search config; `extract()`
  returns `unmodeled_kind` diagnostics naming both kinds.
- Integration: extension-owned operator/opclass objects from a contrib extension
  do not trigger diagnostics.
- Unit: strict diagnostic gate throws on `unmodeled_kind`.
- CLI: `plan --strict-coverage` refuses to produce a plan when unmodeled user
  objects exist.
- Corpus: current corpus should remain clean, with no unmodeled diagnostics.

## Finding 2: P0/P1 — Diagnostics Need To Be Surfaced

### Evidence

The CLI extracts source/desired but does not print extraction diagnostics before
planning:

- `packages/pg-delta-next/src/cli/commands/plan.ts:100`
- `packages/pg-delta-next/src/cli/commands/plan.ts:118`

`schema apply` similarly loads SQL files and extracts the target, but does not
surface `loadResult.diagnostics` or `targetResult.diagnostics` in the main path:

- `packages/pg-delta-next/src/cli/commands/schema.ts:179`
- `packages/pg-delta-next/src/cli/commands/schema.ts:185`

`snapshot`, `diff`, and `drift` also extract and should have a consistent
diagnostic story.

### Why This Matters

Unmodeled-kind detection only closes the correctness gap if users actually see
the warning or can opt into failing on it.

### Recommended Module

Add a CLI diagnostic rendering Module:

```text
packages/pg-delta-next/src/cli/diagnostics.ts
```

Interface:

```ts
export function printDiagnostics(
  diagnostics: readonly Diagnostic[],
  options?: { failOnError?: boolean },
): void;

export function hasBlockingDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: { strictCoverage?: boolean },
): boolean;
```

Use it in:

- `plan`
- `diff`
- `snapshot`
- `drift`
- `schema apply`
- `schema export`, if extraction diagnostics apply there too
- `prove`, if re-extraction diagnostics should influence the result

The output should include severity, code, subject if present, and message. It
should not bury diagnostics behind debug logs.

## Finding 3: P1 — `Policy.baseline` Is Inert Unless The Caller Applies It

### Evidence

`supabasePolicy` declares a baseline:

- `packages/pg-delta-next/src/policy/supabase.ts:146`
- `packages/pg-delta-next/src/policy/supabase.ts:156`

But `plan()` says baseline subtraction happens before planning:

- `packages/pg-delta-next/src/plan/plan.ts:107`

The baseline directory currently contains only `.gitkeep`, and the remaining
work doc says committed Supabase baselines and resolution are still missing:

- `packages/pg-delta-next/src/policy/baselines/.gitkeep`
- `docs/remaining-work/tier-3-service-migration-baselines.md`

### Why This Matters

A policy field that looks declarative but is not consumed is dangerous. Users
and future agents may assume `baseline: "supabase-baseline"` changes the managed
view when it does not.

### Recommended Shape

Keep core `plan(FactBase, FactBase)` pure. Baseline subtraction is a frontend /
policy Adapter concern, not rule-table logic.

Add a small baseline resolution seam:

```ts
export interface BaselineRegistry {
  resolve(id: string, context: { pgMajor: number }): FactBase;
}

export function applyPolicyBaseline(
  source: FactBase,
  desired: FactBase,
  policy: Policy | undefined,
  registry: BaselineRegistry,
): { source: FactBase; desired: FactBase };
```

Then wire that into the CLI/product planning path before calling `plan()`.

Alternatively, if baseline consumption is intentionally caller-side for v1,
remove `baseline` from `Policy` or mark it as metadata-only in docs and types.
Do not leave it ambiguous.

### Tests

- Unit: `baseline: "supabase-17"` resolves and subtracts identical facts.
- Integration: fresh Supabase baseline subtraction leaves no platform-managed
  residue except documented exceptions.
- CLI: Supabase policy planning exercises the committed baseline file.

## Finding 4: P1 — The 4b Provenance Flip Is Partial

### Evidence

The extractor still has `notExtensionMember` anti-joins:

- `packages/pg-delta-next/src/extract/extract.ts:80`

`COVERAGE.md` is honest about the partial flip:

- flipped: schemas, tables, sequences, views/materialized views, routines,
  aggregates, domains, enum/composite/range types, collations;
- still filtered: sub-entity families and rare member-root kinds.

Relevant docs:

- `packages/pg-delta-next/COVERAGE.md:87`
- `packages/pg-delta-next/COVERAGE.md:109`
- `docs/remaining-work/tier-4-deferrals.md:11`

The parity test’s `FLIPPED_KINDS` matches this subset:

- `packages/pg-delta-next/tests/extension-member-parity.test.ts:30`

### Assessment

This is acceptable for correctness-first v1 if the scope statement is precise.
Default behavior remains safe because extension members are projected out where
they are observed, and still filtered where they are not.

The problem is wording. Some roadmap/status docs say "4b shipped" without the
qualifier, while other docs correctly describe the deferred families.

### Recommendation

Rename the status conceptually:

- "4b common member-root provenance flip shipped"
- "4b sub-entity and rare member-root families deferred"

Do not call 4b fully complete without that qualification.

For future completion, use the existing parity oracle:

1. Drop the anti-join for one family.
2. Add `ext_member_of`.
3. Emit `memberOfExtension`.
4. Add the kind to `FLIPPED_KINDS`.
5. Run parity + corpus + differential.

## Finding 5: P1 — Evidence Gates Exist, But Final V1 Evidence Is Still Needed

### Evidence

The branch has a real validation harness:

- corpus proof loop: `tests/engine.test.ts`;
- differential: `tests/differential.test.ts`;
- generative soak: `tests/generative.test.ts`;
- extension-member parity: `tests/extension-member-parity.test.ts`;
- proof coverage tests: `src/proof/prove.test.ts`;
- SQL-file loader atomicity tests: `tests/load-sql-files-atomicity.test.ts`.

The workflow does run PG 15/17/18 unit/integration and a sharded corpus:

- `.github/workflows/pg-delta-next.yml`

However, the v1 docs still require:

- full differential with `PGDELTA_NEXT_DIFFERENTIAL=all`;
- agreed generative soak quota;
- real-world shakedown;
- committed Supabase baselines;
- PG18 confirmation in some cutover docs;
- migration-guide/evidence record.

The tier-2 cutover doc explicitly says the soak quota is still TBD:

- `docs/remaining-work/tier-2-stage-10-cutover.md:35`

### Recommendation

Before declaring v1, create a short evidence artifact, for example:

```text
docs/pg-delta-next-v1-evidence.md
```

It should record:

- commit SHA;
- PG versions;
- exact commands;
- pass/fail summaries;
- differential bucket counts;
- soak seed range and quota;
- corpus scenario count;
- real-world schema description, anonymized;
- known accepted differences;
- remaining deliberate exclusions.

Suggested command set:

```bash
cd packages/pg-delta-next

bun run check-types

PGDELTA_TEST_IMAGE=postgres:15-alpine bun test tests/engine.test.ts
PGDELTA_TEST_IMAGE=postgres:17-alpine bun test tests/engine.test.ts
PGDELTA_TEST_IMAGE=postgres:18-alpine bun test tests/engine.test.ts

PGDELTA_NEXT_DIFFERENTIAL=all \
PGDELTA_TEST_IMAGE=postgres:17-alpine \
  bun test tests/differential.test.ts

PGDELTA_NEXT_SOAK=<agreed-quota> \
PGDELTA_TEST_IMAGE=postgres:17-alpine \
  bun test tests/generative.test.ts
```

If feasible, run differential and soak on more than PG17. If that is too slow,
record why PG17 is the representative lane.

## Finding 6: P2 — SQL Loader Should Reject Explicit Transaction Control

### Evidence

The loader now wraps each file in an explicit transaction:

- `packages/pg-delta-next/src/frontends/load-sql-files.ts:56`

This fixes ordinary mid-file failures and has tests:

- `packages/pg-delta-next/tests/load-sql-files-atomicity.test.ts`

But a SQL file containing explicit `COMMIT` can still commit partial DDL before
a later statement fails. The hardening plan itself identified explicit
`BEGIN`/`COMMIT` as the real narrow gap.

### Assessment

This is not as important as unmodeled-kind detection, but the current comment
"each file applies inside an explicit transaction" is only true for files that
do not contain transaction-control statements.

### Recommendation

Reject transaction-control statements in declarative SQL files with a clear
`ShadowLoadError` diagnostic.

This can be a conservative scanner that strips comments and string literals and
then rejects statement-boundary forms:

- `BEGIN`
- `COMMIT`
- `ROLLBACK`
- `SAVEPOINT`
- `RELEASE SAVEPOINT`
- `PREPARE TRANSACTION`
- `COMMIT PREPARED`
- `ROLLBACK PREPARED`

This is not dependency inference and does not violate the "Postgres is the
elaborator" principle. It is a loader safety check.

## Finding 7: P2 — Comment And Roadmap Drift

### Examples

`pg-delta-next-hardening-plan.md` says 4b is not started in one section, then
says it shipped later:

- `docs/pg-delta-next-hardening-plan.md:219`
- `docs/pg-delta-next-hardening-plan.md:434`

`IdFieldPredicate` still says typos silently never match, but validation now
rejects unknown fields:

- `packages/pg-delta-next/src/policy/policy.ts:127`
- `packages/pg-delta-next/src/policy/policy.ts:650`

`plan.ts` still has the old first-consumer `commitBoundaryAfter` boundary logic:

- `packages/pg-delta-next/src/plan/plan.ts:658`

`apply.ts` now correctly treats `commitBoundaryAfter` as an unconditional
segment boundary:

- `packages/pg-delta-next/src/apply/apply.ts:46`

### Recommendation

Clean these before v1. They are not major correctness risks, but they increase
the chance that the next model or maintainer implements against the wrong mental
model.

## Non-Blockers For Correctness-First V1

### Extension-Intent Phase B

Phase B is absent in code, as the docs say:

- no `extensionIntent` kind;
- no `intentRules`;
- no pgmq / pg_cron handlers;
- no replay actions.

This should not block correctness-first v1 unless the product promises
from-empty rebuild fidelity for pgmq queues, cron jobs, or partman parents.
Current docs sensibly move this to post-v1 / DX.

### Performance

Serial extraction is correct because it runs under one repeatable-read read-only
transaction. Parallel snapshot workers are a performance optimization, not a
correctness requirement.

### Planner Refactor

The planner is still large, but the current split is reasonable:

- `plan.ts` keeps the cohesive mutation-heavy algorithm;
- `internal.ts` owns graph construction, tie keys, compaction, and safety report;
- `rules.ts` remains the per-kind rule table.

Further splitting is optional polish. It should not precede the v1 correctness
items above.

## Suggested Pre-V1 Work Plan

### Step 1: Implement Unmodeled-Kind Detection

Files likely touched:

- `packages/pg-delta-next/src/extract/unmodeled.ts`
- `packages/pg-delta-next/src/extract/extract.ts`
- `packages/pg-delta-next/src/core/diagnostic.ts` if the diagnostic type needs
  a typed code union
- integration tests under `packages/pg-delta-next/tests/`

Done when:

- user-created unmodeled catalog objects produce diagnostics;
- extension-owned variants do not produce noise;
- strict mode can fail on diagnostics;
- corpus remains clean.

### Step 2: Surface Diagnostics In CLI/Frontend Paths

Files likely touched:

- `packages/pg-delta-next/src/cli/diagnostics.ts`
- `packages/pg-delta-next/src/cli/commands/plan.ts`
- `packages/pg-delta-next/src/cli/commands/diff.ts`
- `packages/pg-delta-next/src/cli/commands/snapshot.ts`
- `packages/pg-delta-next/src/cli/commands/drift.ts`
- `packages/pg-delta-next/src/cli/commands/schema.ts`
- possibly `packages/pg-delta-next/src/cli/commands/prove.ts`

Done when:

- warnings print by default;
- `--strict-coverage` or equivalent fails before producing a plan;
- tests prove both behaviors.

### Step 3: Resolve Or Remove `Policy.baseline`

Files likely touched if wiring:

- `packages/pg-delta-next/src/policy/baseline.ts`
- `packages/pg-delta-next/src/policy/supabase.ts`
- `packages/pg-delta-next/src/policy/baselines/*.json`
- CLI planning path
- tests for baseline resolution

Done when one of these is true:

- `Policy.baseline` actually resolves and subtracts a committed baseline; or
- the field is removed/renamed so nobody thinks it is active.

### Step 4: Clean V1 Status Docs

Files likely touched:

- `docs/pg-delta-next-remaining-work.md`
- `docs/pg-delta-next-hardening-plan.md`
- `docs/remaining-work/README.md`
- `docs/remaining-work/tier-4-deferrals.md`
- `packages/pg-delta-next/README.md`
- `packages/pg-delta-next/COVERAGE.md`

Done when:

- the 4b status is consistently described as partial/common-root shipped;
- unmodeled-kind detection is either marked done or remains the only blocker;
- strict coverage behavior is documented;
- unsupported kinds are documented as "diagnosed, not silently ignored."

### Step 5: Run And Record The V1 Evidence Gates

Create or update:

- `docs/pg-delta-next-v1-evidence.md`

Done when:

- corpus is green on supported PG versions;
- `EXPECTED_RED` is empty or deleted according to the cutover plan;
- full differential is run and bucket counts are recorded;
- soak quota is agreed and recorded;
- real-world shakedown is recorded;
- Supabase baseline path is exercised or explicitly excluded from v1.

## Final Call

The implementation is technically strong and mostly aligned with the documents.
The managed-view architecture is the right abstraction: it gives callers
leverage through one view Interface and gives maintainers locality for scope,
provenance, capability, and proof honesty.

The remaining correctness work is concentrated and tractable. Do not spend the
next effort on broad planner refactors or extension-intent replay. Close the
catalog-completeness hole, make diagnostics visible, settle baseline semantics,
then record the final gates. That is the shortest path to a trustworthy v1.
