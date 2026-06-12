# North Star Architecture: pg-delta & pg-topo

- **Status**: North star — the project's target design, judged on technical
  merit alone, deliberately ignoring migration cost and past choices
- **Date**: 2026-06-12
- **Baseline for all code citations**: commit `115dde8`
  (`pg-delta@1.0.0-alpha.28`, `pg-topo@1.0.0-alpha.1`)

This document defines where the project is going. It is not a critique of how
it got here: the current design is the strongest in its class (it is the only
tool in the migra/pg-schema-diff family that treats `pg_depend` as the source
of ordering truth), and its accumulated PostgreSQL knowledge is the asset the
north star is built from. But the north star is derived from the problem, not
from the codebase — §9 then re-derives an incremental path from today's code
toward it. When a local decision conflicts with this document, this document
wins or this document gets amended.

---

## 1. The problem, stated purely

Given two PostgreSQL schema states — each obtainable from a live database,
from SQL files, or from a serialized snapshot — produce a **minimal,
correctly ordered, reviewable, safety-classified** DDL script that transforms
one state into the other, **deterministically**, and be able to **prove** it
did.

Five sub-problems follow from this statement, and any architecture in this
space must answer all five: state capture, comparison, action synthesis,
ordering, execution. Every serious tool (pg_dump/pg_restore itself, migra,
pg-schema-diff, atlas, skeema) converges on this staged shape; the
architectural freedom — and where this design differs from the current
codebase — is *within* the stages: where semantic knowledge lives, who is
trusted to elaborate PostgreSQL semantics, how cycles are handled, and how
correctness is established.

Out of scope, permanently: data migrations (DML). The tool's contract is
schema state, not data movement.

---

## 2. The two principles

Everything in this design follows from two principles.

### P1 — Postgres is the only elaborator

The single deepest source of bugs in this tool class is reimplementing
PostgreSQL semantics: name resolution, type elaboration, dependency
inference, default normalization. The current codebase half-commits to this
principle (dependency edges come from `pg_depend`, never from parsing — the
right call) but still runs **three** semantic engines:

1. catalog extraction (exact),
2. pg-topo's libpg-query static analysis (approximate — quoted-identifier
   normalization, signature inference, builtin-type filtering are all
   heuristic recoveries of what Postgres already knows),
3. declarative apply's round-based retry, which is "ask Postgres for
   forgiveness, one error message at a time"
   ([round-apply.ts:252-281](../packages/pg-delta/src/core/declarative-apply/round-apply.ts),
   worst-case O(n²) statement executions).

The north star has **one**: every input state is resolved by an actual
Postgres instance. Live databases trivially; SQL files by applying them to an
ephemeral shadow database and extracting the result; the system's own output
by applying it to a scratch clone and re-extracting (§3.7). No static SQL
parser exists anywhere in the trusted path. Static analysis survives only as
a developer-experience layer (§4.4).

### P2 — PostgreSQL knowledge exists in exactly two forms

The per-type knowledge — what is alterable, what forces replacement, what
cascades implicitly, what locks, what rewrites — is the irreducible core of
the problem. Today it is smeared across **eight forms**: extractor SQL, Zod
models, per-type diff functions, 106 change classes, serializers, custom
sort constraints, cycle breakers, and post-diff normalization passes. Every
new PostgreSQL version or object type touches most of them.

The north star has **two**:

1. **Extraction queries** — catalog → facts (the existing extractor SQL
   corpus, the most valuable code in the repository, survives nearly
   verbatim).
2. **The rule table** — fact-deltas → actions (§3.3).

Everything between — diffing, ordering, planning, verification — is generic
machinery that never changes when Postgres evolves. Supporting PostgreSQL 19
means updating extraction queries and adding rules. **That is the
scalability that matters most over a decade: scaling with PostgreSQL's
evolution, not only with schema size.**

---

## 3. The architecture

```text
frontends:   live DB ──(single-snapshot extract)──┐
             SQL files ──(shadow-DB elaboration)──┼──▶  FACT BASE
             snapshot JSON ───────────────────────┘     typed facts + dependency edges,
                                                        content-addressed (hash per object)
                                  │
                     generic set-diff (hash compare — zero per-type code)
                                  │
                              DELTA SET
                                  │
                     RULE TABLE  ◀── the only per-type logic in the system
                                  │
                          ATOMIC ACTIONS
              maximally decomposed; each declares produces / consumes /
              destroys, lock class, rewrite risk, data-loss class,
              transactionality
                                  │
              ONE dependency graph → one deterministic topological sort
              (a cycle is a rule bug caught by CI, not a runtime repair job)
                                  │
              optional COMPACTION: merge adjacent actions into idiomatic DDL
              only where no edge crosses the merge (cosmetics; off for machines)
                                  │
                   PLAN = actions + fingerprints + safety report
                                  │
            ┌── PROOF: apply to scratch clone, re-extract, hash-compare ──┐
            └──────────── apply (lock-aware segmented txns) ──────────────┘
```

### 3.1 The fact base

One normalized, immutable representation of "a schema state," identical
regardless of origin. Three properties define it:

- **Typed identity.** Stable IDs are a parsed discriminated union
  (`{kind: "procedure", schema, name, args}` …) with a frozen canonical
  string form for persistence and graph keys. Structure is accessed by
  field, never recovered by regex (today:
  [expand-replace-dependencies.ts:419-425](../packages/pg-delta/src/core/expand-replace-dependencies.ts)
  slices `"procedure:"` strings apart).
- **Content addressing.** Every object carries a content hash computed once
  at construction from its normalized equality surface (the existing
  `stableSnapshot()` normalizations — the "physical attnums vs logical
  names" doctrine — carry over intact). A catalog is effectively a Merkle
  set: equality checks, fingerprints, no-op detection, and caching are all
  O(1) per object. (Today equality is a double `JSON.stringify` per shared
  object per diff —
  [base.model.ts:70-75](../packages/pg-delta/src/core/objects/base.model.ts),
  [objects/utils.ts:36-37](../packages/pg-delta/src/core/objects/utils.ts).)
- **Dependencies as facts.** `pg_depend`-derived edges (plus the synthesized
  ACL/membership/ownership edges) are part of the state, extracted under the
  same snapshot as everything else.

### 3.2 Frontends: one elaborator, three doors

- **Live database**: all extraction queries run against one exported
  snapshot (`pg_export_snapshot()` + `SET TRANSACTION SNAPSHOT` on N worker
  connections — the pg_dump-parallel model). Parallel *and* consistent.
  Today's extraction has neither property: ~28 queries race over a 5-connection
  pool with no shared transaction
  ([catalog.model.ts:352-381](../packages/pg-delta/src/core/catalog.model.ts),
  [postgres-config.ts:108](../packages/pg-delta/src/core/postgres-config.ts)),
  so the catalog and its dependency rows can disagree under concurrent DDL —
  masked by the `unknown:` filter in
  [graph-builder.ts:26-33](../packages/pg-delta/src/core/sort/graph-builder.ts).
- **SQL files**: applied in a single pass to an ephemeral shadow database
  (template-cloned; `check_function_bodies = off`), then extracted. The
  desired state is whatever Postgres actually builds — no fuzzy reference
  matching, no retry heuristics. This *is* the declarative workflow.
- **Snapshots**: the serialized fact base round-trips losslessly (exists
  today as `serializeCatalog`/`deserializeCatalog`; becomes the contract for
  offline diffing, fixtures, and caching).

### 3.3 Generic diff

With content addressing, comparison is set algebra on `(stableId → hash)`:
added, removed, changed. **Zero per-type diff code** — no `table.diff.ts`
(1,034 lines today), no per-type diff functions at all. Per-type knowledge is
not needed to detect *that* something changed; it is needed only to decide
*what to do about it* — which is the rule table's job.

### 3.4 The rule table

The only per-type logic in the system. For each object kind, structured data
declares:

```ts
// sketch — rules are data with functions in narrow slots only
interface KindRules<M> {
  kind: ObjectKind;
  identitySql(m: M): string;
  createTemplate(m: M): string;                    // bare object only (§3.5)
  attributes: Record<string, AttributeRule<M>>;    // per changed attribute:
  //   { alter: (old, new) => string }             //   in-place ALTER
  //   | { replace: true }                         //   forces drop+create
  //   | { replace: (old, new) => boolean }        //   conditional (e.g. column type)
  implicitlyDrops(m: M): StableId[];               // cascade knowledge (DROP TABLE → its
                                                   // constraints, columns, owned sequences)
  lockClass(action: Action): LockClass;
  rewriteRisk(action: Action): boolean;
  dataLossClass(action: Action): DataLoss;
}
```

Hard cases — column type changes, view replacement chains, procedure
signature identity — are *conditional rules with more structure*, not
imperative escape hatches. The discipline that keeps rules from degenerating
into code-in-disguise: functions appear only in predicate and template
slots, and every rule's claims are checked by the proof loop (§3.7) — a rule
that lies about cascades or alterability produces a state mismatch in CI,
not a latent bug.

This replaces, outright: 21 per-type diff functions, 106 change classes, the
five per-`objectType` dispatch switches
([catalog.diff.ts:47](../packages/pg-delta/src/core/catalog.diff.ts),
[change-utils.ts:10](../packages/pg-delta/src/core/change-utils.ts),
[fingerprint.ts:88](../packages/pg-delta/src/core/fingerprint.ts),
[change.types.ts:65](../packages/pg-delta/src/core/change.types.ts),
[file-mapper.ts:59](../packages/pg-delta/src/core/export/file-mapper.ts)),
and the shared privilege/comment/security-label wrapper classes. Today that
surface is 256 files / 31,162 LOC of source in `objects/` alone; the rule
table plus models is estimated at a third of it.

### 3.5 Atomic actions: maximal decomposition

Every action is the smallest valid DDL unit: bare `CREATE TABLE`; every
constraint, default, FK, index, grant, comment, ownership change as its own
action. Each action declares `produces` / `consumes` / `destroys` (stable
IDs), plus the safety metadata from its rule.

This is pg_dump's deep trick, adopted wholesale: **pg_dump has no
cycle-breaker module because at this granularity, cycles structurally cannot
form** for entire categories of dependencies (mutual FKs, FK-vs-drop
interleavings). The current codebase already half-believes this — the create
phase emits constraints as separate `AlterTableAddConstraint` changes
([table.diff.ts:84](../packages/pg-delta/src/core/objects/table/table.diff.ts)),
which is exactly why all three cycle breakers
([cycle-breakers.ts](../packages/pg-delta/src/core/sort/cycle-breakers.ts):
`tryBreakFkCycle`, `tryBreakPublicationColumnCycle`,
`tryBreakPublicationFkConstraintDropCycle`) live in the **drop phase**, where
compound `DROP TABLE` semantics create implicit edges. Worse, the system
currently fights itself: post-diff normalization *prunes* constraint drops
for compactness, then the cycle breaker *re-injects* them when compactness
creates a cycle. The north star resolves the tension in one direction:
decomposed by construction, compacted only where provably safe (§3.6 output
stage).

Failure-mode analysis is the argument: with repair, a new cycle class means
a wrong/unsortable plan in production and a new hand-written breaker (the
git history is a string of exactly these fixes). With avoidance, the
worst case is a more verbose script. Verbosity is recoverable; wrongness is
not.

### 3.6 One graph, one sort, then cosmetic compaction

A single dependency graph over all atomic actions — drops, creates, alters
together. Edges come from three sources: the old state's dependency facts
(teardown ordering: an action destroying X follows everything that consumes
X), the new state's dependency facts (build ordering: an action producing Y
precedes everything consuming Y), and identity conflicts (drop of `X` before
create of new `X`). One deterministic Kahn pass (heap-based ready queue,
tie-break by phase weight → kind weight → name) replaces today's two-phase
sort + `invalidates` side channel + repair loop: an in-place mutation is
simply an action that destroys the old fact and produces the new one, and
the mixed graph orders its dependents' teardown and rebuild around it
naturally.

**A cycle is a rule bug.** Cycle detection remains as an assertion with a
high-quality diagnostic, and as a property-test target — never as a runtime
repair subsystem. (Today: graph rebuilt from scratch on every repair round,
[sort-changes.ts:161-289](../packages/pg-delta/src/core/sort/sort-changes.ts);
full catalog depend-row scan regardless of diff size,
[graph-builder.ts:26](../packages/pg-delta/src/core/sort/graph-builder.ts);
O(V²) ready queue,
[topological-sort.ts:33-52](../packages/pg-delta/src/core/sort/topological-sort.ts).
All of it dissolves rather than getting optimized.)

**Compaction** is the final, optional stage: merge adjacent actions into
idiomatic compound DDL (constraints inlined into `CREATE TABLE`, column
clauses folded) only when no graph edge crosses the merge boundary. It is a
peephole optimization on an already-correct sorted script — it can produce
ugliness, never wrongness. On by default for humans, off for machines.

### 3.7 Plan and proof

A plan is: ordered actions + source/target fingerprints (which are now just
fact-base hashes — same machinery as equality) + the safety report
aggregated from per-action metadata (locks, rewrites, data loss).

**The proof loop is the architecture's keystone.** Because any state can be
materialized (template-cloned scratch DB) and re-extracted, the planner can
certify its own output: apply the plan to a clone of the source, extract,
hash-compare against the desired fact base. Zero diff = proven plan. This
inverts the correctness economy of the whole project:

- **In CI**: property-based testing becomes the primary coverage engine —
  generate schemas, generate mutations, roundtrip, assert fixpoint. The
  hand-written per-type test matrix (127 test files / 18,505 LOC in
  `objects/`, 63 integration files × 3 PG versions × 15 shards = 45 jobs)
  shrinks to a thin integration ring around a generative core.
- **In production**: proof-on-shadow is an optional pre-apply step for
  high-stakes targets.
- **For the rule table**: rules that misdeclare cascades or alterability are
  caught as state mismatches the day they are written, not as field bugs.

### 3.8 Execution

Sequential, lock-aware, segmented: actions self-declare transactionality, so
the executor groups maximal transactional runs and isolates the exceptions
(`CREATE INDEX CONCURRENTLY`, …) instead of today's all-or-nothing single
concatenated script
([apply.ts:125-131](../packages/pg-delta/src/core/plan/apply.ts), with its
own `TODO` admitting the gap at
[apply.ts:122](../packages/pg-delta/src/core/plan/apply.ts)). Parallel DDL
execution stays rejected — `ACCESS EXCLUSIVE` locks make it a deadlock
machine, and the transaction is the atomicity contract. Per-statement error
attribution replaces the joined-string megaquery.

---

## 4. Capabilities the design unlocks

These are not cleanups — they are features the current architecture cannot
express:

### 4.1 Rename detection

Content addressing makes renames visible: an object removed on one side and
added on the other **with the same content hash** is a rename candidate →
emit `ALTER … RENAME` (data-preserving) instead of drop+create
(data-destroying), governed by policy (`auto` / `prompt` / `off`) since
hash-equality is necessary but not sufficient evidence of intent. Every tool
in this class punts on renames; here it falls out of the state
representation.

### 4.2 Proof-certified plans

"This plan was applied to a clone and produced a byte-identical desired
state" is a product claim no comparable tool makes. It also gives drift
detection for free: fingerprint comparison between any environment and any
snapshot is two hash sets.

### 4.3 Generative testing as the safety net

The oracle stops being "did a human anticipate this case in a test file" and
becomes "does apply(plan(A→B), A) equal B" over generated A and B. Coverage
grows with compute, not with test-authoring effort.

### 4.4 An honest role for static analysis

pg-topo exits the trusted path and becomes the developer-experience layer it
is genuinely good at: instant editor feedback, file ordering for humans
authoring declarative schemas, lint, cycle diagnostics. Its approximate
`ObjectRef` identity stops needing to agree with the exact engine, because
nothing downstream depends on it. (Consequence: the libpg-query WASM
dependency leaves the core install —
[package.json:80-89](../packages/pg-delta/package.json) currently forces it
on every consumer.)

### 4.5 Packaging that falls out instead of being debated

The architecture induces the package shape: a lean core (`pg`, `zod`-class
deps only) exposing the layers — fact base / diff / plan / proof / apply —
as independently usable entry points; pg-topo as a dev tool; the CLI as a
consumer of the public API. No further package engineering is required to
get a WASM-free, embeddable core.

---

## 5. What survives from today

The north star is a re-plumbing, not a rewrite of the knowledge. Carried
over nearly verbatim:

- **The extractor SQL corpus** (`<type>.model.ts` queries) — years of
  accumulated `pg_catalog` knowledge across PG versions; the single most
  valuable asset in the repository. It becomes the fact-base producer.
- **The `pg_depend` doctrine** — deepened from "the diff path's source of
  truth" to "the only semantic engine, period" (P1).
- **The normalization knowledge** in `stableSnapshot()` overrides (physical
  attnums vs logical names, etc.) — it becomes the content-hash surface.
- **Stable identity** as a concept — upgraded to typed values with a frozen
  string form.
- **The plan + fingerprint product contract** — plans as reviewable,
  version-controllable artifacts with drift detection.
- **Safety/risk classification** — generalized into per-action metadata
  supplied by the rule table.
- **The serialize/filter DSL surface** for integrations (Supabase rules) —
  re-targeted at actions instead of change classes, same user-facing
  contract.

## 6. What is retired

| Retired | Replaced by |
|---|---|
| 21 per-type diff functions + 106 change classes (256 files / 31,162 LOC) | generic hash diff + rule table (§3.3–3.4) |
| Two-phase sort + `invalidates` side channel + cycle breakers + dependency filter + post-diff normalization-as-repair | one mixed graph, decomposition by construction, cosmetic compaction (§3.5–3.6) |
| Round-based declarative apply ([round-apply.ts](../packages/pg-delta/src/core/declarative-apply/round-apply.ts)) | shadow-DB elaboration through the one plan path (§3.2) |
| pg-topo in the apply path | pg-topo as dev-experience layer (§4.4) |
| String stable-ID re-parsing | typed `StableId` (§3.1) |
| `JSON.stringify` equality + triple extraction per apply | content hashes + single-snapshot extraction + proof-as-opt-in (§3.1, §3.2, §3.7) |
| Hand-written per-type test matrix as primary safety net | generative roundtrip proof + thin integration ring (§4.3) |

## 7. Honest costs

- **Shadow DB requirement.** The SQL-file frontend and the proof loop need a
  reachable Postgres. Template-cloned databases make it cheap; embedded
  options (PGlite) may eventually make it serverless, but extension and
  version parity rule it out of the trusted path today. Environments that
  cannot reach any scratch database lose the declarative frontend — that is
  a real constraint and is accepted.
- **Rule-table expressiveness risk.** The gnarliest ALTER semantics resist
  tabularization; rules can degenerate into code-in-disguise. Mitigations:
  functions confined to predicate/template slots, and the proof loop as a
  lie detector. If a kind genuinely cannot be expressed, the honest response
  is a structured sub-rule vocabulary, not an imperative escape hatch —
  escape hatches are how the current eight-forms situation happened.
- **Verbosity when compaction is conservative.** Cosmetic by construction;
  the compactor can improve forever without correctness risk.
- **Proof costs an extra apply + extract.** Optional per environment; cheap
  with templates and hashes.
- **Output changes during migration.** Decomposition-by-default changes
  emitted SQL relative to today. The oracle therefore shifts: refactor
  phases keep byte-identical output; emission-changing phases are gated on
  **state-proof equality** (apply both old and new plans to clones —
  identical resulting fact bases) plus human review of the new shape. Byte
  drift stops being the invariant; *state* drift becomes the invariant.

## 8. Why the current design cannot simply be tuned into this

The findings below (all verified at `115dde8`) are not isolated bugs — each
is a direct consequence of an architectural commitment the north star
removes:

1. **No shared extraction snapshot** (consistency bug) — consequence of
   extraction being a query fan-out rather than a state capture. §3.2.
2. **O(n²)-flavored equality and sort costs**
   ([base.model.ts:70-75](../packages/pg-delta/src/core/objects/base.model.ts),
   [graph-builder.ts:26](../packages/pg-delta/src/core/sort/graph-builder.ts),
   [topological-sort.ts:33-52](../packages/pg-delta/src/core/sort/topological-sort.ts))
   — consequence of state not being content-addressed and the graph being
   rebuilt as repair. §3.1, §3.6.
3. **31K LOC of structurally identical per-type code** — consequence of
   knowledge-in-eight-forms; every object type re-states the same machinery.
   §3.4 / P2.
4. **A growing cycle-breaker registry, each entry a field-discovered bug** —
   consequence of compact-by-default emission + repair-on-detection. §3.5.
5. **Three semantic engines that must agree but cannot** (exact catalog,
   approximate parser, retry loop) — consequence of not committing to P1.
   §3.2, §4.4.
6. **45-job CI matrix defending hand-written cases** — consequence of
   lacking a proof loop; correctness must be asserted per-case because it
   cannot be checked per-run. §3.7.

## 9. The path from here

Each phase is independently shippable, independently valuable, and strictly
reduces distance to the north star. Standing gates: refactor phases =
byte-identical SQL (existing tests as oracle); emission-changing phases =
state-proof equality (§7); every behavior change carries a changeset and a
RED→GREEN regression test per repository policy.

| # | Phase | North-star component it builds | Notes |
|---|---|---|---|
| 1 | Single-snapshot parallel extraction; memoized content hashes on models; hash-based `equals`; post-apply verify becomes explicit proof opt-in | Fact base §3.1–3.2 | Fixes the consistency bug on day one; hashes later power fingerprints, renames, proof |
| 2 | Typed `StableId` (frozen canonical string form, parse/format round-trip tested); kill regex re-parsing | Fact base identity §3.1 | Wire format byte-frozen — persisted in plan fingerprints |
| 3 | `provePlan(plan, source)` as a first-class API: template-cloned scratch, apply, extract, hash-compare. Adopt as CI oracle; begin generative roundtrip tests; shrink the hand-written integration matrix as proof coverage grows | Proof loop §3.7, §4.3 | **Do this before touching emission** — it is the safety net for phases 5–8 |
| 4 | Sort hygiene while the old sort still exists: depend-row pre-filtering to the change set, single graph build per phase, heap queue | Interim perf | Pure wins now; code is absorbed by phase 6 |
| 5 | Decomposition-by-default emission + the compaction pass; delete cycle breakers by attrition as their cycle classes become unconstructible | §3.5–3.6 | First emission-changing phase; gated on state-proof + review |
| 6 | One mixed graph (old-state edges + new-state edges + identity conflicts) replaces two-phase + `invalidates` + repair loop | §3.6 | A surviving cycle after 5+6 is a rule/emission bug — fix the rule, never add a breaker |
| 7 | Rule table: migrate kinds from per-type diff+classes to rules consumed by the generic engine — cookie-cutter kinds first, table/view/procedure as structured conditional rules last; delete the per-type dispatch switches and the change-class union | §3.3–3.4 / P2 | Largest phase; per-kind PRs; proof loop is the oracle |
| 8 | Shadow-DB frontend for SQL files through the one plan path; round-apply demoted to fallback, then removed; pg-topo repositioned as dev-experience layer; WASM leaves the core install | §3.2, §4.4 | The declarative workflow's correctness becomes the diff engine's correctness |
| 9 | Rename detection (hash-equal candidates, policy-gated); layered public API finalized (fact base / diff / plan / proof / apply); packaging falls out | §4.1, §4.5 | The visible product payoff |

Ordering rationale: 1–3 build the measurement and safety instruments; 4 is
opportunistic; 5–7 are the structural inversion under proof protection; 8–9
are the product payoff. Phases 1, 2, 4 can start immediately and in
parallel.

## 10. Decision log

- **2026-06-12** — This document supersedes the earlier incremental-roadmap
  framing of itself. The maintainer's direction: define the **technical
  optimum without regard to past choices**; it is the project's north star.
  Earlier scoping decisions made under the incremental framing (e.g.
  "moderate packaging") are superseded where this document derives a
  different answer; the shadow-DB convergence decision is unchanged and now
  central (P1).
- Open questions intentionally left to their phases: compaction's default
  aggressiveness (phase 5), rename-policy default (phase 9), the minimum
  integration-test ring kept alongside generative proof (phase 3).

---

## Appendix: baseline metrics (commit `115dde8`)

| Metric | Value |
|---|---|
| pg-delta source (src/) | ~88K LOC, ~511 files |
| `src/core/objects/` | 256 source files / 31,162 LOC; 127 test files / 18,505 LOC |
| Object-type directories / concrete change classes | 21 / 106 |
| `depend.ts` | 1,895 LOC, 2 functions, 30+ CTEs |
| `sort/` | ~4.6K LOC across 15 files (incl. 3 cycle breakers) |
| Integration tests | 63 files × 3 PG versions, 15 CI shards (45 jobs) |
| pg-topo source | ~4.4K LOC, 18 modules; 38 statement classes, 28 object kinds |
| Library hard deps | `pg`, `zod`, `@ts-safeql/sql-tag`, `picomatch`, `debug`, `@stricli/core`, `chalk`, `@supabase/pg-topo` (→ libpg-query WASM) |
