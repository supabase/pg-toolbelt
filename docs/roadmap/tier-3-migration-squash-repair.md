# Tier 3 — Migration squash / repair + multi-file output

- **Status**: 🟡 Substrate exists; build the `squash` / `repair` commands +
  multi-file materialization.
- **Linear**: CLI-1597 (rewrite `migration squash` on pg-delta), CLI-1598
  (multi-file output), CLI-1424 (squash only preserves `public`).
- **One line**: collapse a chain of migration `.sql` files into one consolidated,
  all-schemas migration by diffing **shadow states**, and emit it across multiple
  files.

## What exists (engine substrate)

- **Shadow-DB SQL loader** (`packages/pg-delta-next/src/frontends/load-sql-files.ts`):
  ```ts
  export async function loadSqlFiles(
    files: SqlFile[], shadow: Pool,
    options?: { maxRounds?; mode?: "databaseScratch" | "isolatedCluster" },
  ): Promise<LoadResult /* { factBase, pgVersion, diagnostics, rounds } */>
  ```
  applies a set of `.sql` files into a scratch DB with fail-safe ordering and
  returns the resulting **fact base**. It detects `CREATE INDEX CONCURRENTLY`
  (SQLSTATE 25001) and re-runs it raw.
- **Diff between two states**: `plan(source, desired)` over two fact bases is the
  whole engine — so "diff between two shadow states" is already a one-liner.
- **Segmented executor** (`packages/pg-delta-next/src/apply/apply.ts`):
  `segmentActions(actions)` returns maximal transactional `Segment[]` and knows
  the forced commit boundaries (`commitBoundaryAfter`, `nonTransactional`,
  `newSegmentBefore`). This is the segmentation a multi-file output respects.
- **All-schemas extraction**: `extract()` sees every schema (not just `public`).
  CLI-1424's "public-only" limitation was a `pg_dump` artifact of the old engine
  — it **does not exist** here, by construction.
- **Ordered declarative export** (stage 9): renders a fact base to files that
  load in a single pass — the materialization primitive multi-file output reuses.

## What's missing (the surface to build)

1. **`squash` command** — take a chain of migrations (or a from/to range) and
   emit one consolidated migration.
2. **`migration repair`** — detect drift between recorded migration state and the
   live DB, emit a repair plan.
3. **Multi-file materialization** — render one plan across multiple files
   (by schema / object class), respecting segment boundaries.

## Implementation plan

### 1. `squash` (CLI consumer over loadSqlFiles + plan)

Add `packages/pg-delta-next/src/cli/commands/squash.ts`:

1. `loadSqlFiles(<chain>, shadow)` into a scratch DB → `targetFactBase`.
2. Resolve the **base** to squash *from*: either empty (full squash) or a
   baseline fact base (squash *since* a checkpoint — reuse
   `subtractBaseline`/`loadBaseline`, see [`tier-3-service-migration-baselines.md`](tier-3-service-migration-baselines.md)).
3. `plan(baseFactBase, targetFactBase)` → the consolidated plan.
4. Materialize (single file or multi-file, step 3 below).
5. **Optionally prove** it: apply the squashed plan to a fresh scratch DB and
   assert its fact base equals `targetFactBase` (the squash is *correct by the
   same proof loop*, not by trust).

Because the diff is over fact bases, the output covers **all schemas** —
closing CLI-1424 by construction.

### 2. `migration repair`

Add `packages/pg-delta-next/src/cli/commands/repair.ts`: extract the live DB,
load the recorded migration chain into a shadow, `plan(live, shadowTarget)` →
the actions that reconcile drift. This is the existing `drift` command's data
turned into an emittable plan rather than a report.

### 3. Multi-file materialization

Extend the export renderer to split a plan into files. The split key is a policy
choice (by `schema`, then by object kind); the hard constraint is that
**`commitBoundaryAfter` / `nonTransactional` actions must not be split across a
single transactional file** — derive file boundaries from `segmentActions()` so
each file is independently appliable. Add a `--out-dir` (vs `--out`) flag.

## Tests (RED first)

- **Integration**: author a 3-migration chain (create table → add column → add
  index), `squash` it, apply the squashed plan to a fresh DB, and assert the
  resulting fact base equals the chain's fact base (use `roundtripFidelityTest`
  shape). Author the failing test before the command exists.
- **Integration**: a chain touching `public` **and** another schema → squashed
  output contains both (pins CLI-1424).
- **Integration**: multi-file output where a `CREATE INDEX CONCURRENTLY` lands in
  its own file (segment boundary respected); each file applies standalone.
- **Repair**: introduce drift on a live DB, `repair`, prove convergence.

## Effort / risk

- **Effort**: medium-high (`squash` is small; multi-file materialization +
  `repair` are the bulk).
- **Risk**: low-medium. The diff engine is unchanged; risk is concentrated in
  the file-splitting boundaries (mitigated by deriving them from
  `segmentActions`).

## Cross-links

- Shadow loader: `packages/pg-delta-next/src/frontends/load-sql-files.ts`.
- Segmenter: `packages/pg-delta-next/src/apply/apply.ts`.
- Baselines (squash-since-checkpoint): [`tier-3-service-migration-baselines.md`](tier-3-service-migration-baselines.md).
