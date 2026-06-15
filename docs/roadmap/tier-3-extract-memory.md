# Tier 3 — memory-optimal extraction & diff

- **Status**: 🟠 Net-new engineering; ready to start (Phase 1 is low-risk and
  independently shippable). The end-state (Phase 3) is the technically optimal
  design; gate it on a real large-catalog need.
- **Linear**: to be filed (memory-optimal extraction/diff).
- **One line**: a diff's information content is the **change set**, not the
  catalog — make held memory **O(changes)**, not **O(catalog) × 2**.

## The problem (measured, not assumed)

The engine fully materializes both catalogs as in-memory `FactBase`s before
comparing. Measured on a benchmark fixture (PG17, separate processes, peak RSS
sampled + heap forced-GC'd):

| Catalog (1 side) | JS heap (2 catalogs + diff + plan) | Peak RSS |
|---|---:|---:|
| 11,845 facts | 72 MB (15 MB over a 57 MB baseline) | 204 MB |
| 47,365 facts | 142 MB | ~400–480 MB |
| old engine, ~12k objects (`createPlan`) | — (released internally) | 185 MB |

- The JS heap itself is **lean and stable** — ~660–900 B/fact; two catalogs +
  diff + plan for ~12k objects add only ~15 MB of live objects. The
  content-addressed `FactBase` shares fact objects across `resolveView`
  intermediates, so filtering never duplicates payloads.
- **Peak RSS is dominated by transient extraction, not held state.** It peaks
  during the *second* `extract()` because the `pg` driver **buffers each query's
  full result set** (no cursor / streaming) while catalog #1 is still held.
- **vs the old engine: comparable, ~10% higher peak** (204 MB vs 185 MB). The
  new engine is not dramatically leaner in peak RSS — it trades a little memory
  (cached rollup hashes per fact, two retained catalogs) for its O(hash) diff.
  It wins on *cumulative* memory per apply: the old path did 3 extractions
  (source + target + post-apply verify); the new path makes verify opt-in.

**OOM extrapolation** (~linear): 100k facts ≈ ~1 GB, 250k ≈ ~2–2.5 GB, 500k+ →
OOM on a default heap. "Facts" counts columns/constraints/defaults/ACLs
separately, so ~250k facts ≈ ~25k tables. **The sharpest edge is `pg` buffering**
— one query returning millions of rows (millions of columns, or millions of
`pg_depend` rows) spikes transient RSS regardless of object count, and is the
realistic OOM trigger long before steady-state heap is the problem.

> The set-based resolver rewrite ([`tier-3-extract-depends-perf.md`](tier-3-extract-depends-perf.md))
> is **client-memory-neutral**: same `dependRows` result shape; the new CTEs use
> Postgres `work_mem` (disk-spills, never OOMs the server).

## The reframing

The diff already embodies the right idea — it **skips unchanged subtrees** via
Merkle-rollup equality. But it skips them *after* materializing everything, just
to compute the rollups. The optimal design **pushes that skip upstream to
extraction**, so unchanged objects are never materialized. The floor is
`O(changes + edge-neighborhood-of-changes)`; everything above that is waste.

## The technically optimal architecture: two-pass "hash-manifest → fetch-changed"

Within a single `REPEATABLE READ` snapshot (preserves the v1 single-snapshot
consistency guarantee — both passes see the same state), per side:

1. **Pass 1 — manifest, cursor-streamed.** Stream every object's payload through
   a server-side cursor, compute its `contentHash`, and **retain only
   `(encodedId, parent, hash)`; discard the payload.** Held state collapses from
   full payloads (~660 B/fact) to a hash manifest (~100–150 B/object).
2. **Compare manifests** — both sides are now small id→hash maps → added /
   removed / changed ids. (This is the existing rollup-equality skip, done before
   materialization.)
3. **Pass 2 — fetch only the change-neighborhood.** Materialize full facts only
   for changed/added/removed objects + their subtrees + incident edges, from the
   same snapshot. Held: **O(changes)**.
4. **Plan / sort** on that small `FactBase`, unchanged. `resolveView`, the proof
   loop, and "the plan you prove == the plan you run" operate on the
   change-neighborhood base and are unaffected.

**Result:** held memory `O(objects × hash + changes × payload)`; the transient
extraction peak is bounded by the cursor batch. For the common case (small diff
vs a large catalog), ≈ **10–50× less** than today.

### Two flavors — which is genuinely optimal

| Flavor | Held | Wire | Correctness cost |
|---|---|---|---|
| **(A) client-side hash in Pass 1** *(recommended)* | O(objects × hash) | payloads transferred once | **none** — the faithful `contentHash` |
| (B) server-side SQL change-digest | O(objects × (id+hash)) | unchanged objects never transferred | **high** — a per-kind digest with a strict *no-false-negatives* duty; a missed source column = a missed diff = a wrong migration |

(B) is the absolute floor (least memory *and* network) but fights the
correctness-first ethos: proving "never misses a change" across every object
kind is an ongoing hazard. **(A) is the optimal *safe* design** — faithful
hashes, payloads never retained for unchanged objects. Reserve (B) only if wire
transfer (not memory) becomes the binding constraint at extreme scale.

### What must stay available

The full-materialization path is still correct and is genuinely needed by the
`snapshot` / `export` commands (they serialize every fact) and by
`serializeSnapshot`/`rootHash`. Keep it; the streaming path is a diff/plan
optimization, selected when the caller only needs a plan.

## Phased plan

Each phase is independently shippable and follows **Test-Driven Fixes** (RED
test named below, authored before the production change). The depend-edges
oracle, the full corpus, the differential gate, and a **new peak-RSS regression
budget in `scripts/benchmark.ts`** gate every step — plans must stay byte- and
edge-identical.

### Phase 1 — cursor-stream the unbounded extractors + a `maxFacts` guard 🟠

Replace the buffered `q()` for the two high-cardinality extractors (columns,
`pg_depend`) with server-side cursors (`pg-cursor` / `DECLARE … FETCH`), folding
rows into facts/edges in bounded batches. Add an opt-in `maxFacts` (or per-query
row cap) that fails with an actionable `Diagnostic` — the same shape as the
`statementTimeoutMs` budget already shipped — instead of a silent OOM.

- **Why first**: directly bounds the transient peak — the measured OOM edge —
  *without* touching the diff architecture. Small, low-risk, biggest real-world
  safety win.
- **RED**: a test that drives `extract()` against a fixture exceeding `maxFacts`
  and asserts the actionable diagnostic; a streaming-vs-buffered test asserting
  byte-identical facts/edges (reuse the depend-edges oracle).
- **Effort**: small. **Risk**: low (extraction internals only).

### Phase 2 — stream the snapshot side 🟡

In the dominant CI case (live DB vs a committed snapshot file), the snapshot
already carries per-fact hashes. Stream-compare it instead of deserializing the
whole file into a `FactBase`. Halves held memory in that case for little effort.

- **RED**: a snapshot-vs-live diff test asserting identical deltas with the
  snapshot side never fully materialized (assert via a memory probe or a
  streaming-only code path).
- **Effort**: small–medium. **Risk**: low.

### Phase 3 — the two-pass manifest diff (flavor A) 🟠

The O(changes) end-state. Extraction grows a manifest pass + a targeted fetch
pass; the rollup-guided in-memory descent is replaced by manifest comparison.
Keep full materialization for `snapshot`/`export`.

- **RED**: a large-fixture diff asserting (a) identical plan to the
  full-materialization path (the corpus is the oracle), and (b) a peak-RSS
  budget far below the full-materialization baseline.
- **Effort**: large (a diff-engine change). **Risk**: medium — the corpus +
  differential + oracle are the gate; the manifest must be provably equivalent
  to rollup-equality.
- **Gate**: pursue when a concrete 250k+-object catalog needs it. If/when built,
  use flavor (A), not the SQL-digest floor.

## Recommendation

Ship **Phase 1 now** — it eliminates the failure mode actually reachable today
(the `pg` full-result buffering) at low risk. Treat **Phase 3 as the documented
"technically optimal" end-state**, built when a real large-catalog need appears.

## Cross-links

- Extraction / diff: `packages/pg-delta-next/src/extract/extract.ts`,
  `packages/pg-delta-next/src/core/{fact,diff}.ts`.
- Memory profile method: `scripts/benchmark.ts` (extend with a peak-RSS budget).
- Sibling perf work (shipped): [`tier-3-extract-depends-perf.md`](tier-3-extract-depends-perf.md).
- Snapshot path that must keep full materialization:
  `packages/pg-delta-next/src/core/snapshot.ts`.
