# Tier 3 — Stripe Sync Engine `db reset`

- **Status**: 🟡 Engine lever exists (externally-managed schema); the rest is
  **CLI orchestration outside this engine**.
- **Linear**: CLI-1582 (`db reset` fails with the local Stripe Sync Engine).
- **One line**: treat the Stripe-owned schema as externally-managed so pg-delta
  never drops it or emits cross-schema FKs against it; the reset *sequencing*
  lives in the Supabase CLI.

## The problem

The local Stripe Sync Engine owns a schema (e.g. `stripe`) that is populated by
an integration container, not by the user's migrations. On `db reset`, the diff
either tries to drop that schema's objects or emits cross-schema foreign keys
against tables the integration hasn't created yet, breaking the reset.

## What's the engine's part vs not

This splits cleanly:

| Concern | Where it lives | Status |
|---|---|---|
| **Don't drop / don't FK-reference the Stripe schema** | pg-delta-next policy (this engine) | 🟡 mechanism exists |
| **Sequence `db reset` ↔ Stripe integration container** (bring the container up *before* / *after* the right step) | Supabase CLI orchestration | ➖ out of this repo |

The engine-side lever is identical to managed-schema / baseline handling: mark
the integration-owned schema **externally managed** and exclude it from the plan.

## What exists (engine substrate)

- **Schema exclusion via policy** — `{ schema: "stripe" }` → `exclude`
  (`packages/pg-delta-next/src/policy/policy.ts`); same shape the Supabase policy
  already uses for system schemas
  (`packages/pg-delta-next/src/policy/supabase.ts`).
- **Baseline subtraction** — if the Stripe schema has a known shape, capture it
  as a baseline and subtract it
  (`packages/pg-delta-next/src/policy/baseline.ts`; see
  [`tier-3-service-migration-baselines.md`](tier-3-service-migration-baselines.md)).
- **Cross-schema edges come from `pg_depend`** — so excluding the schema's facts
  also removes the engine's *knowledge* of them; the missing-requirement guard
  then prevents emitting an FK whose target was filtered out.

## Implementation plan (engine side only)

### 1. An externally-managed-schema policy fragment

Add a reusable policy fragment (or extend the Supabase policy) that excludes a
configurable set of integration-owned schemas:

```ts
// e.g. an option on the supabase policy, or a standalone fragment
filter: [
  { match: { schema: "stripe" }, action: "exclude" },
  { match: { edgeTo: { schema: "stripe" } }, action: "exclude" }, // drop FKs *into* it
]
```

The second rule matters: a user table with an FK *into* the Stripe schema must
also be filtered (or that FK action would dangle).

### 2. Surface it as a flag/config

Reuse the [`object-filtering flags`](tier-3-object-filtering-flags.md)
(`--exclude-schema stripe`) so no Stripe-specific engine code is needed — the
externally-managed-schema case is just a named application of the generic
exclusion.

### 3. Document the orchestration boundary

State explicitly that the **`db reset` ↔ container sequencing** is Supabase-CLI
work, not pg-delta-next. The engine's contract is only: *given the Stripe schema
is declared externally-managed, never emit DDL that touches it.*

## Tests (RED first)

- **Integration**: a DB with a `stripe`-like externally-managed schema + a user
  table with an FK into it; with the exclusion policy, `plan` emits **no** drops
  against `stripe` and **no** cross-schema FK action. Author failing first
  (without the policy, the drops/FKs appear).

## Effort / risk

- **Effort**: small (engine side); the orchestration is a separate, larger
  Supabase-CLI task tracked outside this repo.
- **Risk**: low for the engine lever. Be honest in the doc that this ticket is
  **mostly not an engine problem** — over-scoping it into the engine would be the
  failure mode.

## Cross-links

- Generic exclusion: [`tier-3-object-filtering-flags.md`](tier-3-object-filtering-flags.md).
- Baseline approach: [`tier-3-service-migration-baselines.md`](tier-3-service-migration-baselines.md).
- Managed-schema precedent: `packages/pg-delta-next/src/policy/supabase.ts`.
