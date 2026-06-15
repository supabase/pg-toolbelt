# pg-delta-next: why we rebuilt the schema-diff engine

> **TL;DR** — `@supabase/pg-delta` compares two PostgreSQL databases and emits a
> migration to turn one into the other. The original engine was correct but had
> grown to **~54,000 lines** in which PostgreSQL's semantics were re-implemented
> in **eight** different places, with **no way to prove a migration actually
> works** before shipping it. `pg-delta-next` is a clean-room rebuild on a single
> idea — *let PostgreSQL be the only thing that understands PostgreSQL* — and a
> single safety net: **every migration is applied to a throwaway clone and
> proven to converge, with your data intact, before you trust it.** The result is
> **~11,000 lines (79% smaller)**, one rule table instead of ~100 hand-written
> change classes, and a correctness guarantee the old engine never had.

- **Audience**: engineers, reviewers, and decision-makers evaluating the rewrite.
- **Status**: engine code-complete and proven on a 211-scenario corpus across
  PostgreSQL 15/17/18; cutting v1 on correctness. See [roadmap/v1.md](roadmap/v1.md).
- **Deep design**: [architecture/target-architecture.md](architecture/target-architecture.md)
  (the north star) and [architecture/managed-view-architecture.md](architecture/managed-view-architecture.md).

---

## 1. The problem with the old engine

A schema-diff tool lives or dies on one question: **does the migration it
generates actually produce the target schema, without destroying data?** The old
`pg-delta` answered this with human review and a large integration suite — never
with a machine check. And the reason it *couldn't* cheaply add one is the deeper
problem: it re-implemented PostgreSQL's own rules, over and over.

### Knowledge was smeared across eight forms

To diff two databases the old engine had to "know" PostgreSQL semantics, and that
knowledge lived in eight different shapes that all had to agree:

```mermaid
flowchart TB
    subgraph OLD["OLD pg-delta — PostgreSQL knowledge in 8 places"]
        direction LR
        A1["1. Extractor SQL"]
        A2["2. Zod models"]
        A3["3. Per-type diff fns (×21)"]
        A4["4. ~100 change classes"]
        A5["5. Serializers"]
        A6["6. Custom sort constraints"]
        A7["7. Cycle breakers"]
        A8["8. Post-diff normalization"]
    end
    A1 -. "must stay consistent with" .- A4
    A3 -. "must stay consistent with" .- A5
    A6 -. "must stay consistent with" .- A7
```

Every new object type or edge case meant touching several of these in lockstep.
Worse, three of them are *independent semantic engines* that each re-derive what
PostgreSQL already knows:

| Re-implemented engine | What it did | Failure mode |
|---|---|---|
| Catalog extraction | Read `pg_catalog` into models | Drifts from real catalog under concurrent DDL |
| libpg-query static analysis (`pg-topo`, WASM) | Parse SQL to infer types/identifiers | Approximate — heuristics disagree with the server |
| Round-based apply | Retry statements until they stick | Worst-case **O(n²)** statement executions |

The single deepest source of bugs in this class of tool is **re-implementing
PostgreSQL semantics**. The old engine did it three times.

### There was no proof loop

The old engine generated a plan and applied it. Nothing re-extracted the result
and checked it equalled the target; nothing seeded rows and checked they
survived. Correctness was discovered in the field, one bug report at a time.

### It had grown enormous

The verified shape of the old codebase today:

```mermaid
pie title Old pg-delta source (53,933 LOC) — where it lived
    "objects/ — per-type change classes" : 49667
    "everything else (extract, diff, sort, plan, apply)" : 4266
```

**92% of the source was per-object-type boilerplate** — 383 files across 22
object-type directories — most of it structurally identical create/alter/drop/
privilege/comment/security-label handling repeated per type.

---

## 2. The core bet: two principles

`pg-delta-next` is built on two inversions (full rationale in
[architecture/target-architecture.md](architecture/target-architecture.md) §2):

**P1 — PostgreSQL is the only elaborator.** Every input state is resolved by an
actual PostgreSQL instance (the live DB, or a shadow DB the engine populates from
your `.sql` files). The engine never parses SQL to *understand* it. There is one
semantic engine, not three. (Static analysis survives only as a dev-time
convenience, never in the trusted path.)

**P2 — PostgreSQL knowledge lives in exactly two forms:** (1) the **extraction
queries** that turn a catalog into facts, and (2) the **rule table** that turns a
fact-level change into DDL. Eight forms collapse to two.

---

## 3. The new architecture in one picture

```mermaid
flowchart LR
    DB[(source DB)] --> EX
    SQL["desired .sql files"] --> SH[(shadow DB)] --> EX
    EX["extract<br/>(1 consistent txn)"] --> FB["fact base<br/>content-addressed,<br/>Merkle rollups"]
    FB --> DIFF["generic diff<br/>(zero per-kind code)"]
    DIFF --> RULES["rule table →<br/>atomic actions"]
    RULES --> GRAPH["one dependency graph →<br/>one deterministic sort"]
    GRAPH --> APPLY["apply<br/>(single txn,<br/>per-statement attribution)"]
    GRAPH --> PROVE{{"PROVE on a clone:<br/>state == target?<br/>data preserved?"}}
    PROVE -->|yes| TRUST["trusted migration"]
    PROVE -->|drift| REJECT["rejected in CI"]
```

Everything flows at **one granularity — the fact.** A table, column, constraint,
index, policy, ACL entry, ownership edge, extension membership: each is its own
content-addressed fact. State, diff, dependencies, and actions all live at that
same grain, so:

- **diff is generic** — a rollup-guided descent emitting `add`/`remove`/`set`/
  `link`/`unlink` deltas, with *zero per-type code*;
- **ordering needs no cycle-breakers** — at fact grain, dependency cycles
  structurally cannot form (the trick `pg_dump` uses), so one deterministic
  topological pass replaces the old two-phase sort + `invalidates` side-channel +
  repair loop + three hand-written cycle breakers;
- **the proof loop is cheap** — because re-extraction produces the same facts, a
  migration is *proven* by applying it to a clone, re-extracting, and checking
  the fact hashes match (state proof) and seeded rows survive (data proof).

---

## 4. Old vs new, by the numbers

All figures verified against the working tree (`packages/pg-delta` vs
`packages/pg-delta-next`).

| Dimension | OLD `pg-delta` | NEW `pg-delta-next` | Change |
|---|---:|---:|---|
| Source LOC (non-test) | 53,933 | 11,351 | **−79%** |
| `objects/` per-type code | 383 files / 49,667 LOC | one rule table / 2,183 LOC | **−96% LOC** |
| Semantic engines | 3 (catalog + libpg-query + round-retry) | 1 (PostgreSQL itself) | **−2** |
| Forms of PG knowledge | 8 | 2 | **−6** |
| Per-type diff functions | 21 | 0 (generic diff) | **eliminated** |
| Hand-written change classes | ~100 | 0 (data-driven rules) | **eliminated** |
| Cycle-breaker code | 3 hand-written breakers | 0 (cycles can't form) | **eliminated** |
| Apply model | round-based retry, worst-case O(n²) | ordered single pass | **asymptotically faster** |
| Migration proof | none | state + data-preservation proof on a clone | **new guarantee** |
| Serialize escape-hatch params | many (`skipSchema`, `skipAuthorization`, …) | 1 (`concurrentIndexes`) | **collapsed** |
| libpg-query / WASM in trusted path | yes (hard dependency) | no (dev-time only) | **removed** |

```mermaid
flowchart LR
    subgraph O["OLD: 3 engines re-deriving PG"]
        direction TB
        oc["catalog extraction"]
        ol["libpg-query analysis"]
        orr["round-based retry"]
    end
    subgraph N["NEW: PostgreSQL is the elaborator"]
        direction TB
        pg[("a real PostgreSQL<br/>instance")]
    end
    O -->|"clean-room rebuild"| N
```

### Why the test suite shrank too

The old engine carried **34,454 lines of tests** — largely per-type unit tests
asserting exact SQL strings. The new engine proves correctness *behaviourally*
instead: a **211-scenario corpus, run in both directions (build and teardown),
under the full proof loop, on PostgreSQL 15, 17 and 18**, plus a differential
harness (new-vs-old, hard regression gate) and a generative soak. Correctness is
demonstrated by "apply it and re-extract — does it match?", not by pinning byte
strings. (See [archive/v1-readiness-review.md](archive/v1-readiness-review.md)
for an independent assessment.)

---

## 5. What it does better — and differently

**Correctness is mechanical, not aspirational.** The proof loop is the keystone:
a rule that emits wrong DDL is caught in CI when the clone fails to converge or a
seeded row vanishes — not by a user in production. This *inverts the correctness
economy* of the whole project.

**The managed view is one definition, not three mechanisms.** Scope filtering,
ownership, and "what can this applier actually execute" used to be three
inconsistent code paths (`excludeManaged`, `excludeExtensionMembers`, post-diff
`filterDeltas`) plus serialize escape-hatch params. They collapse into a single
`resolveView(facts, policy, capability)` applied identically before `plan()` and
`prove()` — so the plan you prove is exactly the plan you run. See
[architecture/managed-view-architecture.md](architecture/managed-view-architecture.md).

**It never silently misses your schema.** If you created an object in a kind the
engine doesn't model (a custom cast, operator class, text-search config, …), the
old engine would simply not see it. The new engine runs a provenance-aware
*catalog completeness check* and reports it as an `unmodeled_kind` diagnostic;
`--strict-coverage` refuses to plan while unmanaged user objects exist. Honest by
construction: it manages X, or it tells you it doesn't.

**Ordering is correct by construction.** No cycle-breaker registry that grows by
one entry per field-discovered cycle — at fact grain there are no cycles to break.

**The core library is lean.** `createPlan` consumers no longer pull a WASM SQL
parser into the trusted path. PostgreSQL does the elaboration.

**It resolves most known issues by design.** Of **134 tracked issues** in the
diffing-2.0 project, roughly **90 are resolved by construction, by the corpus, or
by policy** rather than by porting individual fixes — the architecture dissolves
whole classes of bug. See [archive/linear-assessment.md](archive/linear-assessment.md).

---

## 6. What is deliberately the same — and out of scope

Honest boundaries matter as much as the wins:

- **Same 7-stage pipeline shape and the `creates/drops/requires` change
  contract** — this was the old engine's genuinely good idea; the rebuild keeps
  it and makes the layers generic.
- **Detection, not modeling, of rare kinds** — v1 does not *model* casts,
  operators, text-search objects, statistics objects, user languages, or
  transforms. It *detects and reports* them (above). Modeling is demand-driven,
  post-v1.
- **Data diffing (DML) is permanently out of scope** — this is a schema tool.
- **Performance is not yet a v1 gate.** v1 is cut on *correctness*; the new
  engine may still trail the old one on raw speed until the performance milestone
  (parallel snapshot extraction, `pg_depend` tuning). Correctness first, then
  speed, then DX. See [roadmap/v1.md](roadmap/v1.md).

---

## 7. Where to go next

| You want… | Read |
|---|---|
| The full design rationale (the north star) | [architecture/target-architecture.md](architecture/target-architecture.md) |
| How scope / ownership / capability enter the engine | [architecture/managed-view-architecture.md](architecture/managed-view-architecture.md) |
| How stateful extensions (pgmq, pg_cron, pg_partman) are handled | [architecture/extension-intent.md](architecture/extension-intent.md) |
| What's left before cutting v1 | [roadmap/v1.md](roadmap/v1.md) and [roadmap/README.md](roadmap/README.md) |
| What the engine models / deliberately excludes | [../packages/pg-delta-next/COVERAGE.md](../packages/pg-delta-next/COVERAGE.md) |
| How it was built, stage by stage | [archive/](archive/) |
