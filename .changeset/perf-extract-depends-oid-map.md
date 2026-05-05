---
"@supabase/pg-delta": minor
---

perf(extractCatalog): 95% wall-time reduction via OID-map + auto-ANALYZE

`extractCatalog` previously spent ~95% of its wall time inside
`extractDepends`'s monolithic 1370-line `DEPENDS_SQL`, which materialised
the catalog-dependency graph entirely server-side: a 30-branch `objects`
CTE formatted stable-ids for every pg_depend OID, then a `base` CTE
joined pg_depend × objects on both sides to produce edge tuples. The
intermediate CTE was scanned 6+ times by downstream synthesised CTEs,
and stale planner statistics — typical right after a bulk schema build,
before autovacuum has caught up — pushed the query into an O(N²) plan
that ran for 5-10 seconds even on modest catalogs.

Two changes:

1. Move stable-id construction from SQL to TS. Splits depends extraction
   into three queries: `RAW_DEPENDS_SQL` returns raw pg_depend tuples,
   `OID_IDENTITY_SQL` returns a (classid, objid, objsubid) → stable_id
   table, and the trimmed `DEPENDS_SQL` keeps just the synthesised
   per-class CTEs (comments, view rewrites, FK constraints, indexes,
   ownership, publications, FDW, etc.). A new TS function
   `translateRawDepends` joins the raw tuples to identity rows via an
   OID map, replacing the SQL `base` CTE with a JS `Map` lookup. The
   `LEFT JOIN objects` references in `view_rewrite_*_deps` were dropped
   since each consumer already had inline `format()` fallbacks.

2. `extractCatalog` now runs `ANALYZE` once before the parallel
   extractor batch. Targeted analyse on individual pg_catalog tables
   was insufficient (the planner needs a full pass to pick a sane plan
   for the synthesised CTEs); database-wide `ANALYZE` is fast (~30-100
   ms on a 400-table benchmark) and saves seconds of bad-plan cost when
   stats are stale. Wrapped in try/catch so non-superusers without
   MAINTAIN privilege fall back to existing stats silently.

Bench numbers (`bench:e2e`, pg17, N=400, post-base-init synthetic
schema):

| | before | after |
|---|---|---|
| `extractCatalog` wall | 6733 ms | **312 ms (-95%)** |
| `extractDepends` (serial) | 6726 ms | 88 ms (-99%) |
| `DEPENDS_SQL` | ~700 ms (post-ANALYZE) | 70 ms |
| `total_ms` (extract+diff+sort+plan) | 8448 ms | **2007 ms (-76%)** |

After this change `sortChanges` (issue #250's primary target) becomes
the dominant cost at ~74% of total wall time on this scenario.

Refs #250.
