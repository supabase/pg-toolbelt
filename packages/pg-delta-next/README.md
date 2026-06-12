# @supabase/pg-delta-next

Clean-room rebuild of pg-delta per [`docs/target-architecture.md`](../../docs/target-architecture.md)
and the stage guides (`docs/stage-00` … `stage-10`). **Working name** —
final naming is a stage-10 product decision. Private until the cutover
parity bar.

## What works today (proven by the test suite)

The full pipeline, end to end, on the covered kinds:

```text
extract (one consistent txn)  →  fact base (content-addressed, Merkle rollups)
        →  generic diff (fact deltas — zero per-kind code)
        →  rule table → atomic actions → ONE dependency graph → deterministic sort
        →  apply (single txn, per-statement attribution)
        →  provePlan (state proof + data-preservation proof on a TEMPLATE clone)
```

plus the **declarative frontend**: `loadSqlFiles` applies files to a shadow
database with fail-safe ordering (bounded rounds), routine-body
re-validation, shared-object leak detection, and parser-free DML rejection
— then the result flows through the same plan/prove path.

- **Corpus proof loop**: every scenario in `corpus/` proven in BOTH
  directions (build and teardown) — state proof = zero drift deltas after
  applying the plan to a clone; data proof = seeded rows survive.
- **Fixture-validity layer**: green independently of the engine, so an
  engine failure can never be a broken fixture.
- **Extractor ring**: fixture DDL → asserted facts/payloads/edges,
  deterministic re-extraction, snapshot round-trip, clone fidelity.

## Kind coverage

schema, role (incl. configs), role memberships, default privileges,
extension, table (incl. partitioned/partitions, INHERITS, replica
identity), column, default, constraint (tables + domains), index,
sequence (incl. OWNED BY), view, materialized view, function/procedure,
aggregate, trigger, policy, rewrite rule, event trigger, domain,
enum/composite/range types, collation, publication, subscription,
FDW/server/user-mapping/foreign-table, comments (one global rule),
ACLs (one global rule, REVOKE-first).

The corpus (`corpus/`, ~195 scenarios) is the port of the old pg-delta
integration suite — see `PORTING.md` for the per-case ledger and the
not-ported-with-reason list (Supabase-image, policy-layer/stage-8,
dummy_seclabel, stage-9 renames/export).

Not yet covered: compaction (plans are decomposed/verbose by design),
renames (stage 9), the policy layer + provenance edges (stage 8),
`ALTER TYPE ADD VALUE` same-transaction usage segmentation (one corpus
direction is pinned in `tests/expected-red.ts` for this), security
labels (needs dummy_seclabel image).

Enum value removal/reorder IS covered: the `values` rule renames the old
type aside, creates the desired value set, walks every dependent column
through a `::text` cast, and drops the renamed type — while
`rebuildsDependents` forces views/defaults/routines that reference the
type through a drop + recreate around the migration.

Known v1 simplifications (each has a stage-doc home):

- extension-member objects are filtered at extraction (stage 8 turns this
  into provenance edges + policy)
- executor is single-transaction (three-valued segmentation arrives with
  the kinds that need it — `CREATE INDEX CONCURRENTLY` etc.)
- capture is serial on one snapshot connection (parallel
  `pg_export_snapshot()` workers are a measured optimization)
- a surviving dependent of a destroyed fact is force-rebuilt when its kind
  is rebuildable (view, matview, index, policy, trigger, rule, constraint,
  default, routine); a non-rebuildable survivor whose dependency stays
  gone fails the plan loudly

## Running

```bash
bun test src/        # unit: codec, hashing, fact base, snapshot, diff
bun test tests/      # integration: Docker required (postgres:17-alpine)
bun run check-types
PGDELTA_TEST_IMAGE=postgres:15-alpine bun test tests/   # other PG versions
```

## Guardrails

See `docs/target-architecture.md` §10. The ones most often relevant here:
no SQL parsing in the trusted path; no per-kind code outside the rule
table; a cycle is a rule bug (there is no breaker module, ever); never
assert SQL bytes in tests — assert state, data survival, or action shape.
