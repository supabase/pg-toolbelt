# pg-delta-next hardening plan: make the boundary semantics explicit

- **Status**: **All 8 items shipped (+ a surfaced Item-2 fix). The hardening
  plan is complete.** Item 4b (the provenance flip) and Item 7 (planner module
  split) — the two large remaining efforts — both landed with full corpus green
  on PG15+17 and the differential state-equivalent. See the *Shipped* table.
- **Date**: 2026-06-13
- **Branch / baseline**: `feat/pg-delta-next`. Items 1–6 + 8 landed in
  `c040e08..c918310`; the live head is `c918310`.
- **Governing doc**: `docs/target-architecture.md` (the north star). **This plan
  does not amend it.** Almost every item here *closes a gap between the
  implementation and what the north star already specifies* — explicit
  projection (§3.9), proof tiers proven/observed/vetted (§3.7),
  provenance-as-edges (§3.1), typed predicates over provenance edges (§3.9). Two
  items (enum boundary, SQL-file txn) are robustness fixes within §3.8/§3.2.

## Shipped (Items 1–6 + 8)

Each landed RED→GREEN, gated (unit + types + lint + knip; corpus/integration
where relevant), `private:true` so no changeset.

| Item | Commit | What landed |
|---|---|---|
| 1 — Explicit projection | `c040e08` | `projectTarget(desired, filteredDeltas)` in `src/plan/project.ts`; `plan()` + `provePlan()` fingerprint/diff against the *projected* target, not full `desired`. |
| 2 — Proof coverage | `7a08329` | `ProofCoverage` (per-table `contentMode: fingerprint\|count\|none`); deterministic content fingerprint gated on a stable `schemaSig`; honest `ok`. |
| 3 — Typed predicates | `10cfbc8` | `edgeKind?: EdgeKind` on `EdgeToPredicate` matched in `factMatches`; `KNOWN_ID_FIELDS` + `validateIdFields` so a typo'd `idField` throws in `validatePolicy`. |
| 4a — Satellite consistency | `e605f83` | `pruneOrphanedSatellites` drops comment/acl/securityLabel facts whose `target` is absent → **CLI-1471 can no longer orphan**. |
| 5 — Enum boundary | `603cc48` | `commitBoundaryAfter` unconditionally closes its segment in `segmentActions`; new corpus scenario the **old engine fails, new converges**. |
| 6 — Loader robustness | `c918310` | explicit per-file `BEGIN/COMMIT` + `ROLLBACK`, raw re-run fallback for non-transactional statements (`CREATE INDEX CONCURRENTLY`). |
| 8 — Docs | folded in | README proof claim softened to coverage tiers + `contentMode`. |
| schemaSig fix | `16ffeb4` | composite-type structure + `atttypmod` folded into the proof's `schemaSig` (repaired two Item-2 false-positive corpus scenarios). |
| 4b — provenance flip | `99dee48`, `5a4fbf3`, `5b7f118` | members observed with `memberOfExtension` edges + projected by default; member-root families flipped (parity oracle GREEN); resolver collapse kept for ordering. **Gate: corpus 418/418 on PG15 AND PG17, differential 44/0 (zero regressions).** |
| 7 — planner module split | `88af751` | extracted `buildActionGraph`, `actionTieKey`, `compactColumnFolds`, `computeSafetyReport` to `src/plan/internal.ts` behind the unchanged `plan()` API (−240 lines). **Pure refactor: corpus 418/418 on PG15+17, differential identical to pre-refactor.** |

**What this means for correctness:** the bug 4b's review finding (#1) cited —
CLI-1471 orphan satellites — is **already fixed by 4a**. The remaining 4b work
is the *architectural ideal* ("observe everything, project intentionally"), not
an open bug. That is why it is safe to pause here and treat 4b as a dedicated
migration rather than a tail-end cleanup.

## Guiding principle

The review's thesis is correct and is the organizing idea of this plan: **the
core diff/planner machinery is sound; the risk is safety semantics becoming
implicit at the boundaries** — extraction policy, proof coverage, frontend
loading. Every item below makes one boundary *explicit and auditable*.

A note on what already converges: Phase A's `excludeManaged`
(`src/policy/managed.ts`) is a **fact-level** transform applied symmetrically to
source/desired/proof — chosen precisely because delta-level filtering drifts the
proof. That is the same conclusion the review reaches in finding #2. So Phase A
is not rework; it becomes one input to the projection layer (Item 1).

---

## Work items

Each item: the problem (with the review finding # and my verdict), the fix
*within the architecture*, files, tests/gates, dependencies, and effort/risk.
All work follows repo discipline: RED→GREEN, no SQL-byte assertions
(guardrail 6), corpus + differential gates, `private:true` so no changeset.

### Item 1 — Explicit projection + projected target fingerprint  (review #2, **strong agree**)

**Problem.** `filterDeltas` removes deltas, but the plan's target fingerprint is
the *full, unprojected* `desired`. `provePlan` then diffs the clone against full
`desired` with no policy, so a policy-hidden delta makes the plan intentionally
not converge while the metadata still claims the unprojected target. Ambiguous
target = both a correctness risk and an explainability gap.

**Fix (within §3.9 "baselines = fact-base subtraction; policy decides
visibility").** Introduce an explicit projection step that produces the state
the plan *actually targets*, and fingerprint/prove against that:

```ts
interface Projection {
  projectedSource: FactBase;
  projectedDesired: FactBase;       // == the honest plan target
  ledger: ProjectionEntry[];        // every fact/delta removed, with reason
}
```

Two distinct, clearly-named mechanisms (the review collapses them; keeping them
separate is what makes the semantics crisp):

- **Projection (fact-level, both sides, affects the fingerprint)** — "out of my
  universe." Subtract facts from *both* source and desired so they never diff.
  This is the home for: baseline (`subtractBaseline`), managed/operational
  objects (`excludeManaged`, Phase A), system schemas/roles, and extension
  members (Item 4). The target fingerprint reflects the subtraction.
- **Filtering (delta-level, "I see it, I won't act on this change")** — for
  *verb-specific* suppression (the Supabase policy uses `verb` predicates). A
  filtered delta MUST be reflected in the target: `projectedDesired` is the
  fact base reached by applying only the **kept** deltas to `projectedSource`
  (equivalently, `desired` with each filtered fact reverted to its source
  value). So `fingerprint(projectedDesired)` is honest and
  `diff(proven, projectedDesired) == ∅` is the real proof obligation.

`plan()` computes `projectedDesired` and uses it for fingerprints; `provePlan`
targets it; both surface the `ledger` so "what was intentionally excluded, and
why" is reportable.

**Files.** new `src/policy/project.ts` (compose baseline + managed + policy
projection + filtered-delta reversion → `Projection`); `src/plan/plan.ts`
(target fingerprint from `projectedDesired`; expose `ledger`);
`src/proof/prove.ts` (diff against `projectedDesired`); `src/plan/artifact.ts`
(serialize the ledger); public API in `src/index.ts`.

**Tests/gates.** Unit: a fact-level projection rule removes a fact from both
sides → no delta + fingerprint reflects it; a verb-filtered delta → that fact
reverts to source in `projectedDesired`; the ledger records both with reasons.
Integration: a Supabase-style policy (exclude system schema + filter a `remove`)
→ `provePlan` converges to `projectedDesired`, not full desired. Full corpus
regression.

**Depends on:** nothing. **Enables:** Items 2, 4b. **Effort/risk:** medium /
medium (touches the plan→prove contract; well-bounded by the proof gate).

### Item 2 — Proof reports coverage; content fingerprints for seeded tables  (review #3, **agree**)

**Problem.** `provePlan` verifies drift deltas + row **counts** + `relfilenode`.
`autoSeed` is off by default and few scenarios ship `seed.sql`. Row-count
preservation ≠ content preservation (a lossy type change or truncate+reinsert
passes). The README overstates the guarantee.

**Fix (within §3.7 proven/observed/vetted tiers).** Stop reporting a broad
boolean; report **what was actually checked**:

```ts
interface ProofCoverage {
  tablesChecked: number; tablesSkipped: Array<{ table: string; reason: string }>;
  perTable: Array<{
    table: string;
    contentMode: "fingerprint" | "count" | "none";
    recreated: boolean; rewriteDeclared: boolean;
    rowsBefore: number; rowsAfter: number;
  }>;
}
```

Add **deterministic content fingerprints** for seeded/non-empty kept tables
(`md5(string_agg(t::text, '\n' ORDER BY t::text))` before vs after) — a content
change on a `dataLoss:"none"` table is a violation, not just a count change.
Keep `autoSeed` opt-in (it is an audit mode), but the coverage report makes
"0 rows checked" honest so the verdict can't be misread. The verdict's `ok`
stays, but is now backed by an auditable coverage object.

**Files.** `src/proof/prove.ts` (coverage + content fingerprint); README.md +
`API-REVIEW.md` (proof described as tiers + coverage — see Item 8); expand
`seed.sql` for the destructive corpus scenarios that most need content proof.

**Tests/gates.** RED: a scenario that preserves row count but mutates content
(e.g. a column type change with a lossy `USING`) → today's proof says `ok`; with
content fingerprints it must FAIL. GREEN after the fingerprint check.

**Depends on:** Item 1 (proof must target `projectedDesired`). **Effort/risk:**
medium / low.

### Item 3 — Typed policy predicates + edge-kind in `edgeTo`  (review #7, **agree, independently confirmed**)

**Problem.** `idField` is stringly-typed (a typo silently never matches), and
`edgeTo` matches only the edge *target*'s kind/schema — **not** the edge's
`EdgeKind`. The latter is exactly why Phase A's `managedBy` filtering had to be a
fact-level transform instead of a policy rule.

**Fix (this is literally §3.9: "typed predicates over fact kinds, identities,
provenance edges, and delta verbs").** Add `edgeKind?: EdgeKind` to
`EdgeToPredicate` and match it in `factMatches`. Add per-kind field-name
**validation** in `validatePolicy` (an `idField` naming a field the kind doesn't
have is a config error, not a silent no-match). Prefer typed identity-field
predicates where the kind is known.

**Files.** `src/policy/policy.ts` (`EdgeToPredicate`, `factMatches`,
`validatePolicy`); `src/policy/policy.test.ts`.

**Tests/gates.** `edgeTo: { edgeKind: "memberOfExtension" }` matches only those
edges; an `idField` typo throws in `validatePolicy`. **Depends on:** nothing.
**Enables:** Item 4 (provenance filtering as policy). **Effort/risk:** small /
low. *Good early win.*

### Item 4 — Provenance as edges; filtering as projection  (review #1, **agree; it's the documented end-state**)

**Problem.** Extension-member objects are removed at extraction by
`notExtensionMember` anti-joins. This is the documented v1 stand-in
(`COVERAGE.md`), but it is **inconsistent** — a member object is filtered while
its ACL/comment satellite is not — which is the root of CLI-1471 (orphan `GRANT`
on an extension aggregate). Note: `managedBy` (Phase A) is a *sibling* of
`memberOfExtension`, not the same thing; this item is specifically about
extension **members**.

**Fix — phased**, because the full flip has a large blast radius (every
extractor query) and a real cost (fact-base inflation):

- **4a — extraction consistency (small, immediate correctness).** A satellite
  (acl/comment/securityLabel) of a filtered object must itself be filtered.
  Kills the orphan-satellite bug class (CLI-1471) now, independent of the flip.
  Add a corpus scenario for the extension-member-aggregate GRANT.
- **4b — provenance edges (large, the north-star end-state, §3.1 "provenance is
  data, an edge fact, not an extraction-time filter").** Stop anti-joining
  members; extract them WITH `memberOfExtension` edges to the extension fact.
  Projection (Item 1) + an edge-kind policy rule (Item 3) then excludes them.
  This is the "observe everything, project intentionally" pillar.

**Files.** 4a: `src/extract/extract.ts` (satellite emission gated on target
presence) — or rely on the existing missing-requirement guard and assert it.
4b: `src/extract/extract.ts` (remove `notExtensionMember`, emit
`memberOfExtension` edges across all extractor queries); `src/policy/supabase.ts`
(projection rule for `memberOfExtension`); `COVERAGE.md`.

**Tests/gates.** 4a: CLI-1471 scenario — the aggregate's ACL is excluded with
its extension-member target; no orphan GRANT. 4b: extension-member objects
appear as facts with `memberOfExtension` edges; Supabase projection removes
them; full corpus + differential regression (this changes what enters the fact
base, so the differential oracle is the safety net). **Depends on:** Item 1 +
Item 3 (for 4b). **Effort/risk:** 4a small/low; **4b large/high** — recommend
landing 4a immediately and scheduling 4b as its own gated effort (it may even
be staged per extractor family).

> **4a is shipped (`e605f83`); 4b is NOT started.** The detailed 4b migration
> plan lives in its own section below ("Item 4b — dedicated migration plan").

### Item 5 — `commitBoundaryAfter` becomes an unconditional segment boundary  (review #6, **agree the concern; refine the fix**)

**Problem.** `plan.ts:727` inserts the boundary "before the FIRST graph
successor" of a `commitBoundaryAfter` action. An `ALTER TYPE … ADD VALUE` is an
in-place `set` that *consumes* the type fact; a same-plan consumer of the new
value (e.g. a new column `DEFAULT 'newval'::myenum`) *also* consumes the type —
they are **siblings with no edge between them**, so the consumer may not be a
graph successor → no boundary → both land in one segment → `55P04`.

**Fix.** The review's first option ("model enum labels as facts") **does not
help** — `pg_depend` never records per-label dependencies (everything points at
the type), so no finer edge would ever exist; this is not a granularity-is-one
violation. The correct, cheap fix is the review's second option: in
`segmentActions` (`apply.ts`), treat `commitBoundaryAfter` as an
**unconditional** close-the-current-segment boundary *after* the action,
independent of graph-successor shape. Simplify/remove the successor-search
boundary logic in `plan.ts`. Cost: at most one extra segment.

**Files.** `src/apply/apply.ts` (`segmentActions`); `src/plan/plan.ts` (drop the
conditional boundary insertion); a new corpus scenario: a new enum value used by
a **new column default in the same plan**.

**Tests/gates.** RED: the new corpus scenario fails under proof (or apply) today
if the consumer shares the segment; GREEN with the unconditional boundary.
**Depends on:** nothing. **Effort/risk:** small / low.

### Item 6 — SQL-file shadow loading robustness  (review #5, **partially disagree; narrower fix**)

**Problem (corrected).** The review claims a multi-statement file can *partially*
apply. It mostly cannot: `client.query(file.sql)` uses the **simple** protocol,
which Postgres runs as a **single implicit transaction** — statement 2 failing
rolls statement 1 back, and the whole-file retry is clean. The *real* (narrower)
gaps are files containing **explicit `BEGIN/COMMIT`** (breaks the implicit
atomicity) or **non-transactional statements** (`CREATE INDEX CONCURRENTLY`
*errors* "cannot run inside a transaction block" and can never load).

**Fix (hardening).** Wrap each file attempt in an explicit transaction/savepoint
and `ROLLBACK` on failure (makes the implicit guarantee explicit and robust to
embedded `COMMIT`). Detect non-transactional statements and either classify the
file with a clear diagnostic or strip/rewrite them — in a throwaway shadow,
`CONCURRENTLY` is pointless, so dropping the keyword is safe and lets such files
load.

**Files.** `src/frontends/load-sql-files.ts`; loader tests (a mid-file failure
retries cleanly; a `CONCURRENTLY` file is handled, not stuck-forever).
**Depends on:** nothing. **Effort/risk:** small / low.

### Item 7 — Planner internal module split  (review #4, **partial agree; do last**)

**Problem.** `plan.ts` carries many responsibilities in one module. This is
organization hygiene, **not** a locality violation — per-kind knowledge is
correctly in the rule table (guardrail 3); the planner is the generic machinery.

**Fix.** Behind the **unchanged** public `plan()` API, extract internal modules
(`TransitionClassifier`, `RenameApplier`, `DependentRebuildExpander`,
`ActionEmitter`, `RequirementChecker`, `PlanGraphBuilder`, `Segmenter`,
`Compactor`, `SafetyReporter`). Pure refactor.

**Files.** `src/plan/plan.ts` → split. **Tests/gates.** Full corpus +
differential must show **state-equivalent plans** (zero behavior change).
**Depends on:** Items 1, 2, 5, 6 ("after semantics settle"). **Effort/risk:**
medium / medium — defer until the semantic items land so we refactor a stable
target. **Lowest priority.**

> **NOT started — and explicitly sequenced *after* 4b, not before.** Refactoring
> the planner immediately before the provenance flip would blur whether a corpus
> failure came from the semantic change (4b) or the module movement (7). Do the
> semantic migration first, against the *current* planner module, then split.

### Item 8 — Docs normalization (continuous)  (review #8, **agree**)

**Fix.** Normalize README / `API-REVIEW.md` / `COVERAGE.md` into three buckets:
**implemented & proven**, **implemented with known simplification**,
**deliberately out of the modeled universe**. `COVERAGE.md` is the source of
truth for exclusions. Fix the README proof overstatement (ties to Item 2). Do
this *as part of* each item above (each item updates the relevant bucket) rather
than as a separate pass.

---

## Item 4b — dedicated migration plan (provenance flip)

**This is the one remaining substantive item.** It is *not* "remove some
filters." It is a **semantic migration from absence-as-policy to
presence-plus-projection**: extension members stop being invisible (anti-joined
away at extraction) and instead become observed facts that carry a
`memberOfExtension` provenance edge and are *projected out by default*. That
touches **five layers at once** — extraction, dependency resolution, default
planning semantics, proof semantics, and corpus expectations — which is why it
gets its own gated plan rather than a single patch.

**Acceptance criterion (the contract this migration must satisfy):**

> *Policy-free behavior remains byte-for-byte compatible by default, while raw
> extraction can observe extension members with complete provenance edges.*

In other words: with no policy, the corpus and differential stay green
(members are projected out as before); but `extract()` on its own now returns a
fact base where members are present, each with a `memberOfExtension` edge.

### Why hurrying it is dangerous

Done sloppily, 4b creates a *worse* class of bug than the one it fixes: objects
become visible but not correctly projected (they leak into plans), or
dependency edges point at the wrong abstraction layer (member fact vs the
extension), changing ordering. "Almost right" looks green until one object
family with satellites leaks through. The differential oracle is the safety net,
but only if we gate **after each family**, not just at the end.

### The five stages (each independently shippable, each corpus-gated)

**Stage 0 — default projection first, while extraction still behaves the old
way.** Before observing anything new, add the default projection path
(`excludeExtensionMembers`, keyed on the `memberOfExtension` edge — mirror /
generalize Phase A's `excludeManaged` on `managedBy`) and wire it as a default
in `plan()`/`prove()`. With extraction unchanged this is a **no-op** (there are
no `memberOfExtension` edges yet). **Gate:** full corpus on PG 15 + 17 stays
green. *This proves the new projection path preserves current behavior before
the observed universe expands* — the single most important de-risking step.

**Stage 1 — parity / inventory harness.** Build a test harness that, for each
extractor family, compares **"objects previously removed by `notExtensionMember`"**
against **"objects now present with `memberOfExtension`."** Any mismatch must be
**explicit and asserted**, not discovered later through corpus drift. This is the
instrument that tells us a family flip is faithful *before* the corpus does.

**Stage 2 — flip one extractor family at a time.** Remove `notExtensionMember`
and emit `memberOfExtension` edges family-by-family. **Do not move them all in
one patch.** Suggested family order (satellite-bearing families last, since they
are where leaks hide):

1. schemas
2. tables, columns, constraints, indexes, sequences
3. views, matviews
4. routines (functions/procedures/aggregates), triggers
5. types/domains/collations
6. policies
7. grants / comments / security labels / default privileges (**satellites — last**)

After **each** family: run the parity harness (Stage 1) + the corpus on PG 15.

**Stage 3 — change dependency resolution deliberately.** The pg_depend
edge-resolver today collapses a member reference *to the extension fact* — which
was correct under filtered extraction (the member didn't exist as a fact). Once
members are present, resolving to the **member fact** is the correct behavior,
but it exposes **new edges and new ordering**. This needs its own focused tests
(not just corpus): assert that a reference into an extension member now resolves
to the member, and that the resulting plan order is still valid. Land this
*after* the families are flipped (the member facts must exist first).

**Stage 4 — full gate.** Full corpus on **PG 15 + 17 + the differential** at the
end. This is exactly the kind of work where a single satellite-bearing family
can look green locally and leak in the differential — so the differential is the
final arbiter, not optional.

### Files (4b)

- `src/policy/managed.ts` (or a sibling) — `excludeExtensionMembers` projection
  keyed on `memberOfExtension`; wire as a default in `src/plan/plan.ts` +
  `src/proof/prove.ts`.
- `src/extract/extract.ts` — per family: drop `notExtensionMember`, emit
  `memberOfExtension` edges; the edge-resolver change (Stage 3).
- New parity-harness test (Stage 1) under `tests/` or `src/extract/`.
- `src/policy/supabase.ts` — the Supabase data-package projection rule for
  `memberOfExtension` (so the Supabase corpus stays green).
- `COVERAGE.md` — move extension members from "removed at extraction" to
  "observed, projected by default."

### Gate summary (4b)

- Stage 0: corpus PG 15 + 17 green with the no-op default projection.
- Each family: parity harness asserts removed-set == newly-present-set; corpus
  PG 15 green.
- Stage 3: focused resolver tests (member-targeted edges + ordering) green.
- Stage 4: **full corpus PG 15 + 17 + differential clean.**
- `bun run format-and-lint:fix && bun run check-types && bun run knip` clean at
  every commit.

### Framing

Treat 4b as an **architectural feature** ("complete provenance, intentional
projection"), not a cleanup. Its value is the general capability: a user `GRANT`
on `cron.job_run_details` becomes a first-class, policy-manageable fact instead
of being silently invisible. The CLI-1471 *correctness* motivation is already
banked in 4a — so 4b can be scheduled on its own merits, without correctness
pressure.

---

## Sequencing

```
Item 3 (typed predicates) ─┐
                           ├─▶ Item 4b (provenance flip, large)
Item 1 (projection) ───────┘
        │
        └─▶ Item 2 (proof coverage)

Item 4a (extraction consistency, CLI-1471)  ── independent, quick win
Item 5 (enum boundary)                       ── independent, cheap
Item 6 (SQL-file robustness)                 ── independent, cheap
Item 7 (planner split)  ── after 1,2,5,6
Item 8 (docs)           ── continuous, folded into each item
```

**Recommended order** (✅ = shipped, ⏳ = remaining):

1. ✅ **Item 1 + Item 2** — the coupled, highest-leverage pair (explicit target +
   honest proof). Proof is the architecture's arbiter; everything else trusts it.
2. ✅ **Item 3** — small; unblocks expressing provenance as policy.
3. ✅ **Item 4a** — quick correctness win (CLI-1471), independent.
4. ✅ **Item 5 + Item 6** — independent robustness (landed).
5. ✅ **Item 4b** — the provenance flip, done as its own staged migration
   (Stages 0–4), gated by the parity oracle per family + full corpus +
   differential at the end.
6. ✅ **Item 7** — planner module split, done last, proven state-equivalent.

**Where to pick up:** nothing — all 8 items are shipped. The remaining
`notExtensionMember` anti-joins (sub-entity + rare member-root families) are a
documented, regression-free limitation in COVERAGE.md, not an open item.

## Relationship to the extension-intent work

- **Phase A (shipped)** — `excludeManaged` becomes a projection input under
  Item 1 (no rework; integration only). `managedBy` stays the operational-object
  signal; Item 4 adds the parallel `memberOfExtension` signal for extension
  members.
- **Phase B (intent replay, planned in `extension-intent-phase-b-plan.md`)**
  should land **after** Items 1–4: intent proof depends on explicit projection
  (Item 1) and honest proof (Item 2); intent facts ride the same provenance
  model (Item 4) and benefit from edge-kind predicates (Item 3). Sequencing:
  hardening first, then resume Phase B.

## Risk register (accepted honest-costs, not work items)

The review did not raise these; they are documented north-star costs and belong
on the same "implicit safety at the boundary" register — monitored, not fixed:

- **`pg_depend` routine-body blind spot** (§7): PL/pgSQL and string-literal SQL
  bodies are not dependency-tracked, so body-referenced ordering relies on
  `check_function_bodies=off` + the proof loop catching gaps. No body parsing in
  the trusted path (P1).
- **Rename cross-reference caveat** (§4.1): a rename of an object referenced *by
  name* in another payload (an FK naming its table) degrades silently to
  drop+create, never the reverse.

## Done-when

Shipped (Items 1–6 + 8):

- ✅ Projection is an explicit step; `plan()`/`provePlan` target the *projected*
  desired, not full `desired`.
- ✅ Proof emits a coverage report; seeded tables are content-fingerprinted (on a
  stable `schemaSig`); a count-preserving content mutation is caught; the README
  proof claim matches.
- ✅ Policy predicates are typed and validated; `edgeTo` filters by `EdgeKind`.
- ✅ Extension-member satellites can no longer orphan (CLI-1471 fixed by 4a).
- ✅ `commitBoundaryAfter` always closes its segment; the same-plan enum-consumer
  scenario is green (old engine fails, new converges).
- ✅ SQL-file attempts are transactional; non-transactional statements load via
  the raw fallback, never silently stuck.

Done (4b — the provenance flip):

- ✅ Extension members are observed facts with `memberOfExtension` edges,
  projected out by default; the parity oracle asserts soundness (every observed
  member tagged) + completeness (every catalog member of a flipped kind
  observed); corpus 418/418 on PG15+17 and differential clean (acceptance
  criterion met). Sub-entity families + rare member-root kinds remain filtered
  as a documented, regression-free limitation (COVERAGE.md).

Done (Item 7 — planner module split):

- ✅ The cleanly-separable planner phases (`buildActionGraph`, `actionTieKey`,
  `compactColumnFolds`, `computeSafetyReport`) live in `src/plan/internal.ts`
  behind the unchanged `plan()` API; corpus 418/418 on PG15+17 and the
  differential is identical to pre-refactor (state-equivalent). The cohesive
  emit/rename/suppression core stays in `plan()` by design.
