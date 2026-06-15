# Tier 3 — extractDepends performance — **SHIPPED**

- **Status**: ✅ Shipped (milestone A). Extraction is **~4.2× faster** on a
  large catalog; the dominant query is **7× faster**. Edges are byte-identical
  (oracle-gated). Parallel snapshot extraction is **deliberately deferred** —
  profiling shows it would now win < 2× for a large, consistency-critical
  refactor (see "Why parallel extraction is NOT the win" below).
- **Linear**: CLI-1603 (make `extractDepends` faster).
- **One line**: the bottleneck was never round-trips — it was a single
  correlated `pg_depend` resolver query. We made it set-based.

## Profile first (done — and it overturned the plan)

The roadmap README called **parallel snapshot extraction** "the big win." It is
not. Profiling `extract()` per query on the 11.5k-fact benchmark fixture (PG17)
attributed the time decisively:

| query | before | share |
|---|---:|---:|
| **`pg_depend` resolver** (`dependRows`) | **1434 ms** | **86%** |
| all 35 other extraction queries combined | ~190 ms | 14% |

The resolver ran a ~160-line, 15-branch **correlated `CASE` scalar subquery
twice per `pg_depend` row** (dependent + referenced endpoints) — ~16,700
correlated evaluations on 8,339 rows. By Amdahl's law, parallelizing the other
14% caps at a ~10% improvement. The lever was the one query.

## What shipped

1. **Set-based resolver rewrite** (`packages/pg-delta-next/src/extract/extract.ts`).
   Each resolver branch is now a derived table built **once** over its catalog;
   the distinct endpoint set (`SELECT … UNION SELECT …`) is hash-joined to them
   and a `classid` `CASE` selects the right one (the `classid` gate on every
   join also prevents cross-catalog OID collisions). A single `extm` join keyed
   on `(classid, objid)` over `pg_depend deptype='e'` replaces the six per-branch
   nested `pg_depend` extension-member subqueries. The `json_build_object` shapes
   are byte-identical to the old resolver, so the library-side `toId()` decoder
   is unchanged.

   | metric | before | after | speedup |
   |---|---:|---:|---:|
   | resolver query | 1434 ms | **204 ms** | **7.0×** |
   | `extract` (cold) | 1881 ms | **453 ms** | **4.2×** |
   | `extract` (mutated) | 1523 ms | **323 ms** | **4.7×** |

2. **Statement-timeout budget + actionable diagnostic.** `extract(pool, {
   statementTimeoutMs })` sets `SET LOCAL statement_timeout` on the snapshot
   connection; a query that blows the budget throws `ExtractionTimeoutError`
   naming the offending query (and carrying a `Diagnostic`), instead of an opaque
   `canceling statement due to statement timeout` or an indefinite hang. Default
   is **unlimited** — a legitimate large extraction is never aborted unless the
   caller opts in.

3. **Reproducible per-query profiling.** `scripts/benchmark.ts` gained a
   `PGDELTA_BENCH_PER_QUERY=1` mode that attributes the cold extract per SQL
   round-trip (it wraps the pooled client's `query` for that one extract, then
   restores it — measurement only, never touches the library).

## Why parallel extraction is NOT the win (re-profile, milestone A gate)

After the rewrite, the per-query picture on the same fixture:

| query | after |
|---|---:|
| `pg_depend` resolver | 204 ms (≈45% of a 453 ms extract) |
| 2nd `pg_depend` (column/constraint join) | 65 ms |
| everything else (33 queries) | ~180 ms |

Parallel snapshot extraction (`pg_export_snapshot()` + N workers) parallelizes
*separate* queries. The single largest cost is now one query (the resolver,
204 ms) that a worker pool **cannot split**, so the parallel ceiling is roughly
`max(resolver, longest other) + snapshot setup` ≈ ~250 ms — under 2× — in
exchange for refactoring the entire serial extractor (36 query blocks that push
into shared accumulators) into independent, mergeable units running on separate
connections, while preserving the single-snapshot consistency guarantee. Per the
milestone-A gate ("only build parallel extraction if the residual clearly
justifies it"), it does not. It remains a documented Tier-4 deferral
([`tier-4-deferrals.md`](tier-4-deferrals.md) §3) with this number attached;
revisit if a future profile shows the residual (not the resolver) dominating.

## Tests / regression gates

- **Edge-set oracle** (`packages/pg-delta-next/tests/depend-edges-oracle.test.ts`):
  pins the full `depends`/`owner` edge set on a branch-comprehensive fixture as
  an inline snapshot. The rewrite must not change a single edge.
- **Statement-timeout** (`packages/pg-delta-next/tests/extract-statement-timeout.test.ts`):
  a 1 ms budget against a populated catalog fails with an actionable,
  query-naming `ExtractionTimeoutError`; the default path extracts normally.
- **Extension-member parity** (`tests/extension-member-*.test.ts`): gate the
  `extm` consolidation (extension branches the oracle fixture omits).
- **Corpus + differential**: the full breadth gate (edges drive sort/plan order).

## Cross-links

- Extraction: `packages/pg-delta-next/src/extract/extract.ts`.
- Benchmark harness: `packages/pg-delta-next/scripts/benchmark.ts`
  (`PGDELTA_BENCH_PER_QUERY=1` for the per-query breakdown).
- Deferred (with re-profile number): parallel snapshot in
  [`tier-4-deferrals.md`](tier-4-deferrals.md).
- Feeds the stage-10 performance condition:
  [`tier-2-stage-10-cutover.md`](tier-2-stage-10-cutover.md).
