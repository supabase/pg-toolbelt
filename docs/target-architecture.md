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
codebase — is *within* the stages: how state is represented, where semantic
knowledge lives, who is trusted to elaborate PostgreSQL semantics, how cycles
are handled, and how correctness is established.

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

1. **Extraction queries** — catalog → normalized facts (§3.1). The existing
   extractor SQL corpus, the most valuable code in the repository, survives
   nearly verbatim as the fact producer.
2. **The rule table** — fact-deltas → actions (§3.4).

Everything between — diffing, ordering, planning, verification — is generic
machinery that never changes when Postgres evolves. Supporting PostgreSQL 19
means updating extraction queries and adding rules. **That is the
scalability that matters most over a decade: scaling with PostgreSQL's
evolution, not only with schema size.**

A corollary that the rest of the design depends on: the two forms can only
stay two if state, diff, dependencies, and actions all share **one
granularity** — the fact. The moment state is stored at a coarser grain than
dependencies point at, hand-written translation code reappears (§8.7 shows
this is exactly what happened). The fact base below is therefore not a
storage detail; it is what makes P2 hold.

---

## 3. The architecture

```text
frontends:   live DB ──(single-snapshot extract)──┐
             SQL files ──(shadow-DB elaboration)──┼──▶  FACT BASE
             snapshot JSON ───────────────────────┘     normalized fact rows + parent &
                                                        dependency edges; content hash per
                                                        fact, Merkle rollups along parents
                                  │
                  generic diff: rollup-guided descent → fact-level DELTAS
                  (hash compare — zero per-type code, O(changed))
                                  │
                     RULE TABLE  ◀── the only per-type logic in the system
                                  │
                          ATOMIC ACTIONS  (≈ 1:1 with deltas)
              each declares produces / consumes / destroys, lock class,
              rewrite risk, data-loss class, transactionality
                                  │
              ONE dependency graph → one deterministic topological sort
              (a cycle is a rule bug caught by CI, not a runtime repair job)
                                  │
              optional COMPACTION: merge adjacent actions into idiomatic DDL
              by joining facts along parent relations, only where no edge
              crosses the merge (cosmetics; off for machines)
                                  │
                   PLAN = ordered deltas + fingerprints + safety report
                                  │
            ┌── PROOF: apply to scratch clone, re-extract, hash-compare ──┐
            └──────────── apply (lock-aware segmented txns) ──────────────┘
```

### 3.1 The fact base: a normalized, content-addressed relation

**Normalized, not nested.** PostgreSQL's own catalog is relational —
`pg_attribute`, `pg_constraint`, `pg_attrdef` are rows referencing their
parents, not sub-documents of `pg_class`. The optimal state representation
mirrors that shape instead of re-imposing a document hierarchy on it: every
addressable thing — table, column, constraint, default, index, trigger,
policy, ACL entry, comment, security label, role membership, extension
membership — is its **own fact**:

```ts
interface Fact {
  id: StableId;             // typed union: column:, constraint:, default:, acl:, comment: …
  parent?: StableId;        // hierarchy as a relation, not as containment
  payload: NormalizedAttrs; // cooked attributes (names not attnums, canonical pg_get_*def)
  hash: ContentHash;        // content hash of the normalized payload
}

interface FactBase {
  facts: Map<StableId, Fact>;
  edges: Set<DependencyEdge>;   // pg_depend-derived + ACL/membership/ownership, as data
  rollup: Map<StableId, Hash>;  // Merkle: parent hash folds children's hashes
}
```

Five properties define it:

- **Typed identity.** Stable IDs are a parsed discriminated union
  (`{kind: "procedure", schema, name, args}` …) with a frozen canonical
  string form for persistence and graph keys. Structure is accessed by
  field, never recovered by regex.
- **One granularity everywhere.** Facts, dependency edges, diff deltas, and
  actions all live at the same grain. A `pg_depend` edge that points at a
  column points at a fact that *exists*; nothing maps between coarse state
  and fine dependencies, because there is no coarse state.
- **Content addressing with Merkle rollups.** Every fact hashes its
  normalized payload; every parent's rollup hash folds its children's. Two
  consequences: equality at any granularity is one comparison, and diffing
  is **O(changed)** — subtrees whose rollups match are skipped wholesale.
  Fingerprints, no-op detection, drift detection, and caching are the same
  mechanism.
- **Hierarchy is a view, not the storage.** Renderers and the compactor that
  need "a table with its columns and inlineable constraints" *join* facts
  along the parent relation at render time. The document shape exists where
  documents are useful — output — and nowhere else.
- **Cross-cutting metadata is not special.** A comment is a fact whose
  target is another fact's ID; so is an ACL entry, a security label, a
  membership. There is no "scope" dimension in the system — one global rule
  per metadata kind (§3.4) replaces per-object-type reimplementation.
- **Provenance is data.** "Owned by extension X" is an edge fact, not an
  extraction-time filter. Downstream policy (integrations, vendor filtering)
  decides what to do with provenance instead of extraction deciding what to
  hide.

The payload normalization doctrine carries over from today unchanged
(logical names instead of physical attnums; canonical `pg_get_*def()` output
as the comparison form where Postgres provides it): it answers *what we
know* correctly. The fact model changes *how it is keyed* — which is where
the current design pays (§8.7).

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
- **Snapshots**: the serialized fact base round-trips losslessly and is the
  contract for offline diffing, fixtures, and caching. A flat fact relation
  serializes, filters, and streams trivially — properties a nested document
  model resists.

### 3.3 Generic diff: rollup-guided descent to fact-level deltas

Comparison is hash algebra, top-down: compare rollups; where they match,
skip the entire subtree; where they differ, descend and compare fact hashes;
where a fact differs, compare payload attributes. The output is the system's
central data type:

```ts
type Delta =
  | { verb: "add";    fact: Fact }
  | { verb: "remove"; fact: Fact }
  | { verb: "set";    id: StableId; attr: string; from: unknown; to: unknown };
```

**Zero per-type diff code — structurally, not aspirationally.** The differ
never knows what a table is. Because state is normalized at fact grain, the
generic differ already produces "the default of `column:public.users.email`
changed" — there is no nested document for per-type code to re-walk. (In a
document model, "generic diff" can only say *this table changed somehow*,
and a second, hand-written diff engine per type must rediscover what — that
is precisely the 1,034 lines of
[table.diff.ts](../packages/pg-delta/src/core/objects/table/table.diff.ts)
today, see §8.7.)

Deltas — not statements, not class instances — are also what plans persist:
a delta list is diffable, replayable, and storable by construction.

### 3.4 The rule table

The only per-type logic in the system: structured data mapping deltas to
actions.

```ts
// sketch — rules are data with functions in narrow slots only
interface KindRules<P> {
  kind: FactKind;
  identitySql(p: P): string;
  createTemplate(p: P, view: FactView): string;     // bare object only (§3.5)
  attributes: Record<string, AttributeRule<P>>;     // per changed attribute:
  //   { alter: (from, to, view) => string }        //   in-place ALTER
  //   | { replace: true }                          //   forces drop+create
  //   | { replace: (from, to) => boolean }         //   conditional (e.g. column type)
  implicitlyRemoves(p: P, view: FactView): StableId[]; // cascade knowledge
  lockClass(a: Action): LockClass;
  rewriteRisk(a: Action): boolean;
  dataLossClass(a: Action): DataLoss;
}
```

Three structural consequences of operating on fact deltas:

- **Cross-cutting kinds get one rule, globally.** `comment(target) = text`
  is a single rule for the entire system — not 21 per-object-type comment
  implementations. Same for ACL entries, security labels, memberships. The
  rule count tracks PostgreSQL's *concepts*, not the cross product of
  concepts × object types.
- **Rules receive fact views, not documents.** A rule that renders
  `CREATE TABLE` asks the view API for the children it may inline; the
  hierarchy it needs is computed, not stored.
- **Multi-fact semantic atoms are delta-set rules.** `ALTER COLUMN … TYPE`
  touches the column fact, possibly its default fact, and invalidates
  dependent index/view facts. A rule may match a *set* of related deltas and
  emit the composite action with the correct teardown/rebuild edges — the
  declarative form of the knowledge that today lives in the `invalidates`
  side channel and the expand-replace pass.

Hard cases remain *conditional rules with more structure*, never imperative
escape hatches — escape hatches are how today's eight-forms situation
happened. The discipline that keeps rules honest: functions confined to
predicate/template slots, and the proof loop (§3.7) as a lie detector — a
rule that misdeclares cascades or alterability produces a state mismatch in
CI the day it is written.

This replaces, outright: 21 per-type diff functions, 106 change classes, the
five per-`objectType` dispatch switches
([catalog.diff.ts:47](../packages/pg-delta/src/core/catalog.diff.ts),
[change-utils.ts:10](../packages/pg-delta/src/core/change-utils.ts),
[fingerprint.ts:88](../packages/pg-delta/src/core/fingerprint.ts),
[change.types.ts:65](../packages/pg-delta/src/core/change.types.ts),
[file-mapper.ts:59](../packages/pg-delta/src/core/export/file-mapper.ts)),
and the per-type privilege/comment/security-label wrappers — today 256
files / 31,162 LOC of source in `objects/` alone.

### 3.5 Atomic actions: decomposition mirrors normalization

Actions are ≈1:1 with deltas: bare `CREATE TABLE`; every constraint,
default, FK, index, grant, comment, ownership change as its own action. Each
action declares `produces` / `consumes` / `destroys` (fact IDs) plus the
safety metadata from its rule. **Maximal decomposition in the action space
is the same principle as normalization in the state space — one idea seen
from two sides.** A normalized state diffed at fact grain *naturally* yields
atomic actions; the impedance mismatch of decomposed actions over
document-shaped state cannot arise.

This is also pg_dump's deep trick, adopted wholesale: **pg_dump has no
cycle-breaker module because at this granularity, cycles structurally cannot
form** for entire categories of dependencies (mutual FKs, FK-vs-drop
interleavings). Compound semantics stop being implicit: `DROP TABLE`'s
cascade becomes explicit fact-removals related by edges, ordered by the
graph like everything else.

Failure-mode analysis is the argument for avoidance over repair: with
repair, a new cycle class means a wrong or unsortable plan in production and
a new hand-written breaker (the current registry —
[cycle-breakers.ts](../packages/pg-delta/src/core/sort/cycle-breakers.ts):
`tryBreakFkCycle`, `tryBreakPublicationColumnCycle`,
`tryBreakPublicationFkConstraintDropCycle` — each added after a
field-discovered cycle; the codebase even fights itself, with post-diff
normalization *pruning* constraint drops for compactness that the drop-phase
breaker then *re-injects*). With avoidance, the worst case is a more verbose
script. Verbosity is recoverable; wrongness is not.

### 3.6 One graph, one sort, then cosmetic compaction

A single dependency graph over all atomic actions — drops, creates, alters
together. Edges come from three sources: the old state's edge facts
(teardown ordering: an action destroying X follows everything that consumes
X), the new state's edge facts (build ordering: an action producing Y
precedes everything consuming Y), and identity conflicts (remove of `X`
before add of new `X`). One deterministic Kahn pass (heap-based ready queue,
tie-break by phase weight → kind weight → name) replaces a two-phase sort, an
`invalidates` side channel, and a repair loop: an in-place mutation is simply
an action that destroys the old fact and produces the new one, and the mixed
graph orders its dependents' teardown and rebuild around it naturally.

**A cycle is a rule bug.** Cycle detection remains as an assertion with a
high-quality diagnostic, and as a property-test target — never as a runtime
repair subsystem.

**Compaction** is the final, optional stage: merge adjacent actions into
idiomatic compound DDL (constraints inlined into `CREATE TABLE`, column
clauses folded) by joining facts along parent relations, only when no graph
edge crosses the merge boundary. It is a peephole optimization on an
already-correct sorted script — it can produce ugliness, never wrongness. On
by default for humans, off for machines.

### 3.7 Plan and proof

A plan is: ordered deltas (with their rendered actions) + source/target
fingerprints — which are now just fact-base rollup hashes, the same
machinery as equality — + the safety report aggregated from per-action
metadata (locks, rewrites, data loss).

**The proof loop is the architecture's keystone.** Because any state can be
materialized (template-cloned scratch DB) and re-extracted, the planner can
certify its own output. The proof has two checks, because schema convergence
alone has a blind spot:

1. **State proof.** Apply the plan to a clone of the source, extract,
   hash-compare against the desired fact base. Zero diff = the plan produces
   the right schema.
2. **Data-preservation proof.** A plan that drop+creates a table instead of
   altering it converges to an *identical schema* — and destroys every row.
   State proof cannot see this. So the clone is seeded with rows before
   applying, and the proof asserts they survive wherever the plan claims
   `dataLoss: none`. The safety report stops being a report and becomes a
   **verified claim**.

One failure class remains invisible to any state-based proof: the
**convergent-but-non-minimal** plan (rebuilding an index unnecessarily loses
nothing and converges fine — it is merely catastrophic on a 2 TB table).
Minimality is asserted at the plan level — semantic assertions on action
kinds and budgets, never on SQL bytes — in the test architecture (§4.3).

The proof loop inverts the correctness economy of the whole project:

- **In CI**: it is the universal oracle behind both the scenario corpus and
  the generative engine (§4.3).
- **In production**: proof-on-shadow is an optional pre-apply step for
  high-stakes targets.
- **For the rule table**: rules that misdeclare cascades, alterability, or
  data-loss classes are caught as proof failures the day they are written,
  not as field bugs.

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

### 3.9 Integrations: a policy layer over deltas

Vendor-specific behavior (the Supabase integration today) is policy, not
engine: it decides *which* deltas a user sees and *how* actions render —
never how state is captured, diffed, or ordered. The policy layer has three
instruments, all data:

- **Filtering = predicates over deltas and facts.** A filter rule matches
  delta fields (kind, verb, identity) and fact context — including the
  provenance edges of §3.1. "Hide everything owned by extension X" or
  "never touch schema `auth`" become provenance/identity predicates instead
  of extraction-time suppression: the engine sees everything; policy decides
  visibility. The user-facing DSL contract (declarative patterns,
  first-match-wins rules) carries over, re-targeted at deltas.
- **Serialization options = rule parameterization.** Options like
  `skipAuthorization` stop being per-change-class plumbing and become named
  parameters that a serialize rule passes into the rule table's templates.
- **Baselines = fact-base subtraction.** An "empty catalog" for a managed
  platform (what a fresh Supabase project already contains) is just a fact
  base; "diff against the platform baseline" is set subtraction before
  planning, replacing hand-maintained empty-catalog special cases.

A vendor integration is therefore a data package: predicates + rule
parameters + a baseline snapshot. It is versioned, authored without touching
engine code, and tested with the same proof harness (policy scenarios in the
corpus, §4.3).

---

## 4. Capabilities the design unlocks

These are not cleanups — they are features the current architecture cannot
express:

### 4.1 Rename detection, down to sub-entities

Content addressing makes renames visible at every grain: a fact removed on
one side and added on the other **with the same content hash** is a rename
candidate. At object grain that means `ALTER TABLE … RENAME TO`
(data-preserving) instead of drop+create (data-destroying). At fact grain it
extends to the case that destroys data in practice: **column renames** —
same payload hash, same parent, different name. Governed by policy
(`auto` / `prompt` / `off`), since hash-equality is necessary but not
sufficient evidence of intent. Every tool in this class punts on renames;
here they fall out of the state representation.

### 4.2 Proof-certified plans

"This plan was applied to a clone, produced a hash-identical desired state,
and preserved seeded data everywhere it claimed to" is a product claim no
comparable tool makes. It also gives drift
detection for free: comparing any environment against any snapshot is a
rollup-hash walk.

### 4.3 Tests as data: one harness, a seed corpus, a generative engine

The test architecture is P2 applied to testing itself: **one proof harness
(machinery) + scenarios (data)**.

- **The seed corpus.** Every scenario is a named
  `(DDL_A, DDL_B[, seed rows][, plan assertions])` fixture run through the
  proof harness. The existing integration suite ports into this corpus
  nearly mechanically — its dominant pattern (set up two databases, plan,
  apply, assert convergence) already *is* the proof loop, hand-rolled per
  test. What the corpus preserves is not the old assertions but the
  **problem corpus**: every field-discovered edge case and PostgreSQL
  semantic the project has been burned by — publication/FK-cycle drops,
  policy recreation chains, attnum drift, partition juggling. After the
  extractor SQL, it is the second most valuable asset in the repository,
  and it is exactly what a greenfield engine would otherwise silently
  regress on. The RED→GREEN discipline carries over: every new field bug
  becomes a corpus entry that fails before the fix and is pinned forever
  after.
- **The generative engine.** Property-based testing explores beyond the
  corpus: generate schemas, generate mutations, roundtrip through the proof
  loop — including the data-preservation check (§3.7) — and assert
  fixpoint. Coverage grows with compute, not with test-authoring effort;
  the corpus pins old ground so generation never re-loses it (the fuzzing
  model: seed corpus + exploration).
- **Semantic plan assertions.** Where a scenario's point is *how* the goal
  is reached — minimality, in-place alteration, risk class — the fixture
  asserts action kinds and budgets ("this delta yields an `alter`-class
  action, not a replace"; "≤ N actions"), never SQL bytes. Byte snapshots
  die with the old engine: they assert emission shape, which decomposition
  (§3.5) intentionally changes and the compactor may change again.
- **Differential testing during migration.** Until retired, the old engine
  is itself an oracle: run both engines over the corpus and assert
  state-equivalent plans. Every divergence is a bug in one of them — and
  either finding is valuable.

What this replaces: the hand-written per-type matrix as the primary safety
net (127 unit-test files / 18,505 LOC in `objects/` die with the structures
they assert; 63 integration files × 3 PG versions × 15 CI shards = 45 jobs
collapse into corpus entries behind one harness). What survives unchanged:
extraction tests and catalog baselines (the extractor corpus survives, so
its tests do), and the Supabase integration tests (they assert filtering
policy, not engine behavior).

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
  valuable asset in the repository. It becomes the fact producer; what
  changes is the keying of its output (fact rows instead of nested
  documents), not its content.
- **The integration scenario corpus** — the distilled record of every
  field-discovered failure, and the second most valuable asset after the
  extractor SQL. The scenarios survive as seed-corpus fixtures for the
  proof harness (§4.3); only their implementation-coupled assertions and
  byte-level SQL snapshots are retired.
- **The `pg_depend` doctrine** — deepened from "the diff path's source of
  truth" to "the only semantic engine, period" (P1).
- **The normalization knowledge** in `stableSnapshot()` overrides (physical
  attnums vs logical names, canonical `pg_get_*def()` comparison forms) —
  it becomes the fact payload normalization, i.e. the content-hash surface.
- **Stable identity** as a concept — upgraded to typed values with a frozen
  string form, extended to every fact kind.
- **The plan + fingerprint product contract** — plans as reviewable,
  version-controllable artifacts with drift detection; fingerprints become
  rollup hashes.
- **Safety/risk classification** — generalized into per-action metadata
  supplied by the rule table.
- **The serialize/filter DSL surface** for integrations (Supabase rules) —
  re-targeted at deltas/actions instead of change classes, same user-facing
  contract, strengthened by provenance facts; specified in §3.9.

## 6. What is retired

| Retired | Replaced by |
|---|---|
| Document-shaped catalog models (columns/constraints/privileges/labels nested in `dataFields`, [table.model.ts:211-230](../packages/pg-delta/src/core/objects/table/table.model.ts)) | normalized fact rows with parent relations + Merkle rollups (§3.1) |
| 21 per-type diff functions + 106 change classes (256 files / 31,162 LOC) | rollup-guided generic diff + rule table (§3.3–3.4) |
| Per-type comment/privilege/security-label implementations (the "scope" axis) | one global rule per metadata kind over target-referencing facts (§3.4) |
| Two-phase sort + `invalidates` side channel + cycle breakers + dependency filter + post-diff normalization-as-repair | one mixed graph, decomposition by construction, cosmetic compaction (§3.5–3.6) |
| Round-based declarative apply ([round-apply.ts](../packages/pg-delta/src/core/declarative-apply/round-apply.ts)) | shadow-DB elaboration through the one plan path (§3.2) |
| pg-topo in the apply path | pg-topo as dev-experience layer (§4.4) |
| String stable-ID re-parsing ([expand-replace-dependencies.ts:419-425](../packages/pg-delta/src/core/expand-replace-dependencies.ts)) | typed `StableId` (§3.1) |
| `JSON.stringify` equality + triple extraction per apply | content hashes + single-snapshot extraction + proof-as-opt-in (§3.1, §3.2, §3.7) |
| Hand-written per-type test matrix as primary safety net; byte-level SQL snapshots | one proof harness over the seed scenario corpus + generative exploration + semantic plan assertions (§4.3) |

## 7. Honest costs

- **Shadow DB requirement.** The SQL-file frontend and the proof loop need a
  reachable Postgres. Template-cloned databases make it cheap; embedded
  options (PGlite) may eventually make it serverless, but extension and
  version parity rule it out of the trusted path today. Environments that
  cannot reach any scratch database lose the declarative frontend — that is
  a real constraint and is accepted.
- **Fact-count growth.** Normalization multiplies object count ~10–30× (a
  10k-table schema becomes a few hundred thousand facts). Memory impact is
  trivial; diff cost tracks *changes*, not facts, because of rollup
  skipping. The real cost is conceptual: contributors think in facts and
  views instead of convenient pre-joined documents.
- **Rule-table expressiveness risk.** The gnarliest ALTER semantics resist
  tabularization; rules can degenerate into code-in-disguise. Mitigations:
  functions confined to predicate/template slots, delta-set rules for
  multi-fact atoms, and the proof loop as a lie detector. If a kind
  genuinely cannot be expressed, the honest response is a structured
  sub-rule vocabulary, not an imperative escape hatch — escape hatches are
  how the current eight-forms situation happened.
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
7. **Three granularities that don't agree.** Equality lives at the document
   level (`dataFields` nests columns, constraints, privileges, labels —
   [table.model.ts:211-230](../packages/pg-delta/src/core/objects/table/table.model.ts)),
   dependencies live at the sub-entity level (`pg_depend` targets columns
   and constraints), and actions live at the statement level. Most
   hand-written code is translation between the three:
   [table.create.ts:36-43](../packages/pg-delta/src/core/objects/table/changes/table.create.ts)
   re-enumerates column IDs out of the nested array so the graph can see
   them; the graph builder maintains reverse multimaps to map IDs back onto
   changes; and the 1,034 lines of
   [table.diff.ts](../packages/pg-delta/src/core/objects/table/table.diff.ts)
   exist to re-discover *which nested part* of a "changed" document actually
   changed — a second, per-type diff engine inside each document. The fact
   base removes the translation by removing the disagreement: one
   granularity for state, dependencies, deltas, and actions. §3.1, §3.3.

## 9. The path from here

Each phase is independently shippable, independently valuable, and strictly
reduces distance to the north star. Standing gates: refactor phases =
byte-identical SQL (existing tests as oracle); emission-changing phases =
state-proof equality (§7); every behavior change carries a changeset and a
RED→GREEN regression test per repository policy.

| # | Phase | North-star component it builds | Notes |
|---|---|---|---|
| 1 | Single-snapshot parallel extraction; memoized content hashes on models; hash-based `equals`; post-apply verify becomes explicit proof opt-in | Fact base capture & hashing §3.1–3.2 | Fixes the consistency bug on day one; hashes later power fingerprints, renames, proof |
| 2 | Typed `StableId` (frozen canonical string form, parse/format round-trip tested); kill regex re-parsing | Fact identity §3.1 | Wire format byte-frozen — persisted in plan fingerprints |
| 3 | `provePlan(plan, source)` as a first-class API: template-cloned scratch, apply, extract, hash-compare — plus the data-preservation check (seeded rows). Port the integration scenarios into the seed corpus behind one harness; replace load-bearing SQL snapshots with semantic plan assertions; stand up old-vs-new differential runs; begin generative roundtrip tests | Proof loop §3.7, test architecture §4.3 | **Do this before touching emission** — it is the safety net for phases 5–8 |
| 4 | Sort hygiene while the old sort still exists: depend-row pre-filtering to the change set, single graph build per phase, heap queue | Interim perf | Pure wins now; code is absorbed by phase 6 |
| 5 | Decomposition-by-default emission + the compaction pass; delete cycle breakers by attrition as their cycle classes become unconstructible | §3.5–3.6 | First emission-changing phase; gated on state-proof + review |
| 6 | One mixed graph (old-state edges + new-state edges + identity conflicts) replaces two-phase + `invalidates` + repair loop | §3.6 | A surviving cycle after 5+6 is a rule/emission bug — fix the rule, never add a breaker |
| 7 | Fact-model normalization: flatten sub-entities (columns, constraints, defaults, ACL entries, comments, labels) into facts with parent relations and Merkle rollups, kind by kind; document views become render-time joins; rollup hashes preserve whole-object equality during transition | Fact base §3.1, generic diff §3.3 | Internal refactor — byte-identical SQL gate; enables phase 8 |
| 8 | Rule table: migrate kinds from per-type diff+classes to delta rules consumed by the generic engine — global metadata rules (comment/ACL/label) first, cookie-cutter kinds next, table/view/procedure as structured conditional + delta-set rules last; delete the per-type dispatch switches and the change-class union | §3.3–3.4 / P2 | Largest phase; per-kind PRs; proof loop is the oracle |
| 9 | Shadow-DB frontend for SQL files through the one plan path; round-apply demoted to fallback, then removed; pg-topo repositioned as dev-experience layer; WASM leaves the core install | §3.2, §4.4 | The declarative workflow's correctness becomes the diff engine's correctness |
| 10 | Rename detection (object- and fact-level hash-equal candidates, policy-gated); layered public API finalized (fact base / diff / plan / proof / apply); packaging falls out | §4.1, §4.5 | The visible product payoff |

Ordering rationale: 1–3 build the measurement and safety instruments; 4 is
opportunistic; 5–8 are the structural inversion under proof protection —
emission first (5–6), then state (7), then knowledge (8); 9–10 are the
product payoff. Phases 1, 2, 4 can start immediately and in parallel.

## 10. Guardrails for implementers

This document will be executed phase by phase, likely by different people
and different agents, each holding only part of the context. The invariants
below are absolute. When one seems to block progress, the correct move is to
amend this document (with a decision-log entry) — never to make a local
exception:

1. **The stable-ID wire format is frozen.** The canonical string form is
   persisted in plan fingerprints and synthesized inside extraction SQL. Any
   change to it is a breaking product decision, not a refactor.
2. **No static SQL parsing in the trusted path** — extraction, diffing,
   planning, proof, apply. If a feature seems to need a parser, it belongs
   in the dev-experience layer (§4.4) or the design is wrong (P1).
3. **No imperative escape hatches in the rule table.** If a kind cannot be
   expressed, extend the rule vocabulary with a structured sub-rule form and
   record it in the decision log. One escape hatch is how eight forms of
   knowledge happen again (P2).
4. **A cycle is always a rule or emission bug.** Fix the rule or decompose
   the emission. Adding a cycle breaker — any runtime repair of the graph —
   is forbidden (§3.5–3.6).
5. **No emission-changing work before `provePlan` exists** (phase 3 lands
   before phases 5–8 start). The proof loop is the safety net; building the
   trapeze act first is not faster.
6. **Never assert SQL bytes in new tests.** Assert state (proof), data
   survival (proof), or action kinds/budgets (semantic plan assertions,
   §4.3). Byte assertions re-couple tests to emission shape.
7. **Gates are non-negotiable.** Refactor phases ship byte-identical SQL;
   emission-changing phases ship state-proof equality plus human review of
   the new shape (§7, §9). Every behavior change carries a changeset and a
   RED→GREEN regression per repository policy.
8. **Granularity is one.** State, dependencies, deltas, and actions all live
   at fact grain. Any new structure that nests sub-entities back into
   documents — or any map that translates between grains — is §8.7
   returning.
9. **The proof loop is the arbiter.** A change that passes state +
   data-preservation proof over the corpus and the generative engine is
   presumed correct; a change that cannot be proven that way is presumed
   wrong, however plausible it looks.

This document wins conflicts. If implementation contact shows an invariant
is genuinely wrong, amend the document first — decision-log entry, then
code.

## 11. Decision log

- **2026-06-12 (a)** — This document supersedes the earlier
  incremental-roadmap framing of itself. The maintainer's direction: define
  the **technical optimum without regard to past choices**; it is the
  project's north star. Earlier scoping decisions made under the incremental
  framing (e.g. "moderate packaging") are superseded where this document
  derives a different answer; the shadow-DB convergence decision is
  unchanged and now central (P1).
- **2026-06-12 (b)** — Following maintainer review ("are the change-based
  data structures and captured data the optimum?"), the fact base is
  specified as **fully normalized with Merkle rollup hashing** (§3.1), the
  diff output as fact-level deltas (§3.3), and cross-cutting metadata as
  ordinary target-referencing facts. This unifies state, dependency, delta,
  and action granularity — the property that makes P2's "two forms of
  knowledge" structurally true (§8.7) — and extends rename detection to
  sub-entities (§4.1). The captured *data* (extractor SQL, normalization
  doctrine) is affirmed as correct; the reshaping concerns its keying, plus
  provenance (extension membership) captured as edge facts instead of
  extraction-time filtering.
- **2026-06-12 (c)** — Following maintainer review ("should we keep the
  current tests in some form?"), the test architecture is specified (§4.3):
  the integration suite's *scenarios* are kept as the seed corpus of the
  proof harness; their implementation-coupled assertions and byte-level SQL
  snapshots are not ported. The proof loop gains a **data-preservation
  check** (§3.7), closing the convergent-but-destructive blind spot of
  schema-state proof; convergent-but-non-minimal plans are covered by
  semantic plan assertions. The old engine serves as a differential oracle
  until retired.
- **2026-06-12 (d)** — Pre-handoff review: added the integration policy
  layer specification (§3.9) and the implementer guardrails (§10), in
  preparation for implementation planning being delegated phase by phase.
  The document is considered ready; further refinement happens through
  implementation contact and decision-log amendments.
- Open questions intentionally left to their phases: compaction's default
  aggressiveness (phase 5), rename-policy default (phase 10), how
  aggressively to prune the ported corpus once generative coverage matures
  (phase 3).

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
