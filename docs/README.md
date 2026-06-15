# pg-toolbelt docs

Documentation for the `pg-delta` schema-diff engine and its clean-room rebuild,
`pg-delta-next`. **Start with the overview, then follow the path that fits you.**

## Start here

- **[overview.md](overview.md)** — *Why we rebuilt the engine.* The rewrite's
  rationale, old-vs-new with diagrams and verified numbers, what it does better
  and what's deliberately out of scope. Read this first.

## Map of the docs

```
docs/
  overview.md          ← the rewrite, explained (start here)
  architecture/        ← how the engine works (living design)
  roadmap/             ← what's left to do (forward-looking)
  archive/             ← how it was built (historical record)
```

### architecture/ — living design (authoritative)

How the current engine is designed. These describe the system as it is.

- **[architecture/target-architecture.md](architecture/target-architecture.md)**
  — the north star: the five sub-problems (capture, compare, synthesize, order,
  execute), the two foundational principles, and the fact-base / generic-diff /
  rule-table / one-graph / proof-loop design.
- **[architecture/managed-view-architecture.md](architecture/managed-view-architecture.md)**
  — how scope, ownership, and applier capability enter the engine through one
  `resolveView` definition, closed under the proof loop.
- **[architecture/extension-intent.md](architecture/extension-intent.md)** — how
  diffing handles stateful extensions (pgmq queues, pg_cron schedules, pg_partman
  parents) without destroying their data.

### roadmap/ — forward-looking

The correctness-first path to v1, then performance, then DX.

- **[roadmap/v1.md](roadmap/v1.md)** — the one-page v1 roadmap (what blocks a
  correctness-first cut, then the two post-v1 milestones).
- **[roadmap/README.md](roadmap/README.md)** — per-item index with status legend.
- **[roadmap/v1-evidence.md](roadmap/v1-evidence.md)** — the record to fill when
  the v1 validation gates are run at scale (template).
- **[roadmap/v1-unmodeled-kind-detection.md](roadmap/v1-unmodeled-kind-detection.md)**
  — the catalog-completeness correctness item (shipped).
- **[roadmap/extension-intent-phase-b.md](roadmap/extension-intent-phase-b.md)** —
  the plan for replaying extension intent on a from-scratch rebuild.
- **tier-1 … tier-4** — post-v1 detail: cutover, performance, DX/productization
  (filtering flags, risk classification, squash/repair, baselines, …), and the
  deliberate deferrals.

### archive/ — historical record (not current)

How the engine was built and reviewed — preserved for onboarding and rationale,
not as a description of the present. See **[archive/README.md](archive/README.md)**.

- `stage-00` … `stage-10` — the stage-by-stage build plan (all shipped).
- `hardening-plan.md` — the 8 post-build hardening items (all shipped).
- `linear-assessment.md` — triage of 134 tracked issues against the new engine.
- `v1-readiness-review.md` — an independent readiness review.

## Recommended reading orders

- **"What is this and why?"** → [overview.md](overview.md).
- **"I'm going to work on the engine"** → overview → architecture/target-architecture
  → architecture/managed-view-architecture → the relevant `archive/stage-*` for the
  layer you're touching → [../packages/pg-delta-next/COVERAGE.md](../packages/pg-delta-next/COVERAGE.md).
- **"What's left / what should I pick up?"** → [roadmap/v1.md](roadmap/v1.md) →
  [roadmap/README.md](roadmap/README.md).

## Conventions

- `architecture/` is authoritative and current; `archive/` is point-in-time and
  may describe intentions that later changed — trust the code and `architecture/`
  over `archive/` where they differ.
- Doc links are relative; code references point into `../packages/`.
