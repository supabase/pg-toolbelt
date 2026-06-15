# Tier 1 — Extension-intent Phase B (intent replay)

- **Status**: 🔴 Net-new engineering, code plan ready, **blocked on a design
  decision** (the intent declarative-source format, Linear **CLI-1431**).
- **The single biggest open engineering item.**
- **Canonical code plan**: [`../extension-intent-phase-b-plan.md`](extension-intent-phase-b.md)
  — concrete files, contracts, sequencing, gotchas. *Do not duplicate it; this
  doc is the entry point + the decision that gates it.*
- **Design context**: [`../extension-intent.md`](../architecture/extension-intent.md) (the
  *what* and *why*).
- **Closes on completion**: CLI-1591 Deliverable B (partman `create_parent`),
  CLI-341 (pg_cron jobs), the schema-side of CLI-1385; depends on CLI-1430/1431.

## One sentence

Phase B makes a from-scratch rebuild **recreate** the queues / schedules /
partman parents a project declared — by capturing them as `extensionIntent`
facts and replaying them through the extension's own API (`pgmq.create`,
`cron.schedule`, `partman.create_parent`), ordered and proven by the same
one-graph sort + proof loop as schema. **No second pipeline.**

## Where Phase A left it (the substrate B extends)

Phase A (shipped, proven) gives Phase B everything except the intent half:

- `EdgeKind` includes `"managedBy"` (`packages/pg-delta-next/src/core/fact.ts`).
- `excludeManaged(factBase)` fact-level subtraction
  (`packages/pg-delta-next/src/policy/managed.ts`) — and its 4b counterpart
  `excludeExtensionMembers` (`packages/pg-delta-next/src/policy/extension-members.ts`).
- `ExtensionHandler` + `extractWithHandlers` + `extractManaged`
  (`packages/pg-delta-next/src/policy/extensions/`); the **pg_partman** handler
  emits `managedBy` edges today.
- `provePlan(...)` takes a `reextract` option so the proof re-extract is
  managed-aware (`packages/pg-delta-next/src/proof/prove.ts`).

**Verified absent in code (the work itself):** no `extensionIntent` kind in
`packages/pg-delta-next/src/core/stable-id.ts`; no intent rules in
`packages/pg-delta-next/src/plan/rules.ts`; only the filter-only partman handler
exists (no pgmq / pg_cron handlers); no replay actions; no Phase B tests.

## The 4 implementation steps (from the canonical plan)

Each is its own RED→GREEN commit. Summarized here; the **full contracts,
signatures, and call sites are in [`../extension-intent-phase-b-plan.md`](extension-intent-phase-b.md) §3**.

1. **`extensionIntent` codec** — add
   `{ kind: "extensionIntent"; ext; intentKind; key }` to the `StableId` union +
   `encodeId`/`parseAt` branches (mirror `publicationRel`). Isolated; zero
   planner risk. RED = a round-trip property test.
2. **Intent rule + registry via `PlanParams`** — add an `extensionIntent` RULES
   entry that resolves `params.intentRules.get(`${ext}/${intentKind}`)` and
   delegates create/drop. Widen `KindRules.drop` to accept `params?` and thread
   `paramsFor(fact)` at the **2** drop call sites in `plan.ts`. RED = a synthetic
   fact base proves the replay action lands.
3. **Capture + replay per extension** — one handler per commit, simplest first:
   **pgmq** (no `consumes`) → **pg_cron** (opaque command, order late) →
   **pg_partman** Deliverable B (`consumes` the parent table).
4. **Intent proof + full regression** — `extractManaged` re-capture must
   converge on intent too; per-extension replay-roundtrip integration tests;
   full corpus green PG15+17.

## The decision that gates this — and it is NOT code (CLI-1431 / CLI-1430)

Phase B has **two halves**, and only one is blocked:

- **Replay (steps 1–3 above) is unblocked.** The capture-from-running-state path
  reads the extension's own registry (`pgmq.list_queues()`, `cron.job`,
  `part_config`) and replays it. This works today against a live source.
- **The declarative path is blocked.** When the desired state comes from
  `supabase/schema/` files (not a live DB), the desired catalog **won't contain**
  the intent unless the schema source encodes it. So Phase B's *diff target*
  needs a declared-intent representation — and that representation is undecided.

**The decision (CLI-1431 — declarative source format):** how does a user express
"I want a pgmq queue named X / a cron job on schedule Y / a partman parent on
table Z" in `supabase/schema/`? Two candidate shapes (recorded in the canonical
plan §4 "Deferred B+"):

| Option | Shape | Trade-off |
|---|---|---|
| **A — raw calls (recommended start)** | The schema source just contains the literal `SELECT pgmq.create('X');` / `SELECT cron.schedule(...);` / `SELECT partman.create_parent(...);` calls. The declarative loader runs them into the shadow DB; capture-after-replay produces the same intent facts as a live source. | **One representation, zero new surface.** The shadow frontend already runs arbitrary SQL. The intent "format" is just the extension's own API. P2 divergence risk = none. |
| **B — typed `[extensions.*]` block** | A declarative config block (`[extensions.pgmq] queues = [...]`) that the integration parses into intent facts. | A *second* representation of the same state (the call + the block) → P2 divergence risk. Only justified if raw calls prove error-prone in practice. |

**CLI-1430 (the intent matrix)** is the companion data decision: for each
extension, *which* of its registry columns are **intent** (replay them) vs
**runtime state** (ignore them) — e.g. partman's `part_config` has ~40 columns
but only a handful are intent. This must be settled per-extension before the
step-3 handlers can capture the right subset.

**Recommendation:** adopt **Option A** (raw calls) to unblock immediately — it
needs no new declarative surface and reuses the shadow loader. Reach for Option
B only if Option A's ergonomics fail in the field. With Option A chosen, steps
1–4 of the canonical plan are fully executable.

## Done-when

A from-empty rebuild against a project using pgmq / pg_cron / pg_partman
recreates the declared queues / jobs / partman parents (intent replay), with no
drop of managed objects and no row loss, **proven** by the proof loop (state +
intent convergence + data preservation) on the Supabase image; full corpus green
PG15+17; `../extension-intent.md` §5 phase table updated (B → done).

## Effort / risk

- **Effort**: large (net-new modeling across codec + rules + 3 handlers + proof).
- **Risk**: medium — isolated behind the policy/handler layer (core `rules.ts`
  must not import handlers; intent rules arrive via `PlanParams`). The step-2
  planner-core change (new kind + `drop` signature) is the only change that
  touches the shared path; the full corpus is the regression gate.

## Cross-links

- The 4 ❌ "needs-design" issues in
  [`../pg-delta-next-linear-assessment.md`](../archive/linear-assessment.md)
  (CLI-1591 Deliverable B, CLI-1430, CLI-1431, the design half of CLI-1385) all
  collapse into this cluster. CLI-1555 ("don't drop partman partitions") is
  already **solved by Phase A** — that assessment entry is stale.
