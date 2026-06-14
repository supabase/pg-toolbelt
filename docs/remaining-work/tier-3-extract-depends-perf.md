# Tier 3 — extractDepends performance

- **Status**: 🟡 Consistency class already fixed; remaining work is latency
  tuning on very large DBs.
- **Linear**: CLI-1603 (make `extractDepends` faster).
- **One line**: the snapshot model removed the *correctness* failures; tune the
  raw `pg_depend` query latency on huge schemas.

## What exists (engine substrate)

- **Single-snapshot extraction** (`packages/pg-delta-next/src/extract/extract.ts`):
  ```ts
  // BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY  (one connection)
  export async function extract(pool, options?): Promise<ExtractResult>;
  ```
  All extraction queries run **serially on one `REPEATABLE READ READ ONLY`
  connection**. This already fixes the *consistency* class of old-engine bugs —
  catalog and `pg_depend` rows can no longer be mutually inconsistent (closes
  CLI-1608), and there are no mid-run `cache lookup failed` aborts.
- **The dependency resolver** — a ~170-line `CASE` (extract.ts ~1544–1707) maps
  `pg_depend` rows to `StableId`s; `memberOfExtension` edges via
  `pushMemberEdge()`.

So the architecture-level wins are already banked. What's left is **raw query
time** on databases with very large catalogs.

## What's missing (the surface to build)

1. **A profiled baseline** — we don't yet have a head-to-head extract timing on
   a large (10k+ object) schema isolating *which* queries dominate.
2. **A statement-timeout budget** — a runaway `pg_depend` query on a pathological
   schema should fail with a clear diagnostic, not hang.
3. **Round-trip reduction** — collapse per-kind queries into fewer family
   queries *if* profiling justifies it (a real, but larger, change).

> Note: **parallel snapshot extraction** (`pg_export_snapshot()` + N workers) is
> the bigger structural win but is a separate **Tier 4 deferral**
> ([`tier-4-deferrals.md`](tier-4-deferrals.md)) — it's a measured optimization,
> not correctness. This doc is the *single-connection tuning* subset.

## Implementation plan

### 1. Profile first (don't guess)

Use the existing benchmark harness
(`packages/pg-delta-next/scripts/benchmark.ts`) and the 10k-object fixture to
time `extract()` and attribute time per query (wrap each extractor query with a
timing diagnostic behind an env flag). **Identify the dominant query before
changing anything** — the resolver `CASE` is the suspect, but confirm.

### 2. Statement-timeout budget + diagnostic

Set a per-extraction `statement_timeout` (configurable; sane default) on the
snapshot connection. On timeout, emit a `Diagnostic` naming the query that blew
the budget rather than a bare error — turns an opaque hang into actionable
output.

### 3. Reduce round-trips only if profiling justifies

If profiling shows per-kind query overhead dominating (many small queries), move
toward the target-architecture's "~6 family queries returning `jsonb_agg`"
direction — **never a single mega-query** (target-architecture §3.2). This is the
larger, optional change; gate it on the step-1 numbers.

## Tests

- **Benchmark, not hard assertion**: extend `scripts/benchmark.ts` to record
  extract time on the large fixture and publish it (the stage-10 parity bar wants
  the number). Avoid a flaky `expect(time < N)` gate; prefer a tracked metric.
- **Unit/integration**: the statement-timeout path emits the expected diagnostic
  on a deliberately slow query (e.g. `pg_sleep` in a function) — author this RED
  first if implementing the budget.

## Effort / risk

- **Effort**: small for steps 1–2; medium for step 3 (family-query refactor).
- **Risk**: low for the budget/profiling; medium for the family-query refactor
  (it touches extraction — the corpus + extractor ring are the regression gate).

## Cross-links

- Extraction: `packages/pg-delta-next/src/extract/extract.ts`.
- Benchmark harness: `packages/pg-delta-next/scripts/benchmark.ts`.
- Bigger win, deferred: parallel snapshot in [`tier-4-deferrals.md`](tier-4-deferrals.md).
- This feeds the stage-10 performance condition:
  [`tier-2-stage-10-cutover.md`](tier-2-stage-10-cutover.md).
