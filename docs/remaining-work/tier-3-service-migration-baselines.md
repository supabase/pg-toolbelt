# Tier 3 — Service-migration baselines

- **Status**: 🟡 Mechanism exists; commit the snapshots + decide refresh/ownership.
- **Linear**: CLI-1436 (service-migration baseline mechanism).
- **One line**: ship committed Supabase baseline snapshots so baseline
  subtraction runs in CI, not just on demand.

## What exists (engine substrate)

- **Subtraction** (`packages/pg-delta-next/src/policy/baseline.ts`):
  ```ts
  export function subtractBaseline(fb: FactBase, baseline: FactBase): FactBase;
  export function loadBaseline(path: string): FactBase;  // from snapshot JSON
  ```
  Removes facts identical-in-baseline, preserves parent chains, prunes dangling
  edges.
- **Generator** (`packages/pg-delta-next/scripts/generate-supabase-baseline.ts`):
  connects to a (fresh Supabase) DB, auto-detects the PG major, `extract()`s,
  and writes `serializeSnapshot(...)` to
  `packages/pg-delta-next/src/policy/baselines/supabase-<pgmajor>.json`.
- **Policy wiring**: `Policy.baseline?: string`
  (`packages/pg-delta-next/src/policy/policy.ts`) — a policy can name a baseline.

## What's missing (the surface to build)

- `packages/pg-delta-next/src/policy/baselines/` currently contains **only
  `.gitkeep`** — no baselines are committed. So baseline subtraction is
  *generatable* but **never exercised in CI**.
- The `Policy.baseline` string → committed-file resolution path must be verified
  end-to-end (string id → `loadBaseline(path)`).
- A **refresh/ownership decision**: when the Supabase image tag bumps, the
  baseline must be regenerated. This should hook the existing "Upgrading
  Supabase test images" workflow (the `sync-base-images` discipline in the
  old package's guidelines) so the two move together.

## Implementation plan

### 1. Generate + commit the baselines

For each supported Supabase image tag (track
`POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG`-style mapping; the new package uses
`PGDELTA_SUPABASE_TEST_IMAGE`, default `supabase/postgres:17.6.1.135`):

```bash
cd packages/pg-delta-next
# against a fresh Supabase container per version
bun scripts/generate-supabase-baseline.ts --url <supabase-url>
```

Commit `supabase-15.json`, `supabase-17.json`, … into
`packages/pg-delta-next/src/policy/baselines/`.

### 2. Verify `Policy.baseline` resolution

Confirm/implement that a policy declaring `baseline: "supabase-17"` resolves to
the committed file and applies `subtractBaseline` before planning. If resolution
is currently caller-side only, add a small resolver mapping baseline ids →
`src/policy/baselines/<id>.json`.

### 3. Tie refresh to the image-bump workflow

Document (and ideally script) that bumping the Supabase test image
**regenerates the baseline in the same change** — mirror the old package's rule
that the generated Supabase fixtures are part of the image upgrade, never
hand-edited.

## Tests (RED first)

- **Integration** (CI-runnable once a baseline is committed): extract a fresh
  Supabase container, `subtractBaseline(extract, loadBaseline("supabase-17"))`,
  and assert the **managed delta is empty** (or only the deliberately-tracked
  residue). This is the test that turns "generatable" into "exercised". Author
  it failing (no baseline committed) first.
- **Unit**: `subtractBaseline` removes identical facts, keeps user facts, prunes
  edges to removed endpoints (likely already covered — extend if not).

## Effort / risk

- **Effort**: small (mostly generate + commit + one CI test).
- **Risk**: low. The snapshots are data; the subtraction is tested. The only
  ongoing cost is keeping baselines in sync with image bumps (step 3).

## Cross-links

- `packages/pg-delta-next/src/policy/baseline.ts`,
  `packages/pg-delta-next/scripts/generate-supabase-baseline.ts`.
- Squash-since-checkpoint reuses the same subtraction:
  [`tier-3-migration-squash-repair.md`](tier-3-migration-squash-repair.md).
- Stripe externally-managed schema is the same lever applied to a third-party
  schema: [`tier-3-stripe-sync-engine-reset.md`](tier-3-stripe-sync-engine-reset.md).
