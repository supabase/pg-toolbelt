# Tier 3 — Risk classification 2.0

- **Status**: 🟡 Substrate exists; build the wire format + CLI gate + reporter.
- **Linear**: CLI-1459, CLI-1460, CLI-1461, CLI-1462, CLI-1463, CLI-1464.
- **One line**: turn the engine's proof-verified per-action safety data into a
  stable, consumable **hazard report** with a `--allow-hazards` gate and a
  CI-friendly reporter.

## What exists (engine substrate)

The engine already computes — and the proof loop already *verifies* — the safety
facts the old engine only guessed at:

- Per-action fields on `Action` (`packages/pg-delta-next/src/plan/plan.ts`):
  ```ts
  interface Action {
    dataLoss: "none" | "destructive";
    rewriteRisk: boolean;
    lockClass: LockClass;
    transactionality: "transactional" | "nonTransactional" | "commitBoundaryAfter";
    newSegmentBefore: boolean;
  }
  ```
- Aggregate report on the plan (`packages/pg-delta-next/src/plan/plan.ts`):
  ```ts
  interface SafetyReport {
    destructiveActions: number;
    rewriteRiskActions: number;
    nonTransactionalActions: number;
    lockClasses: Partial<Record<LockClass, number>>;
  }
  ```
  computed by `computeSafetyReport(finalActions)`.
- The vetted lock-class table (`packages/pg-delta-next/src/plan/locks.ts`):
  `LockClass = "none" | "share" | "shareRowExclusive" | "shareUpdateExclusive" | "accessExclusive"`.
- **Proof verification**: `rewriteRisk` is observed on the clone (a kept table
  whose `relfilenode` changed under no `rewriteRisk` action fails the proof) and
  `dataLoss` is checked by the data-preservation proof
  (`packages/pg-delta-next/src/proof/prove.ts`). This is strictly stronger than
  the old engine's `risk.ts`, which hardcoded 3 `data_loss` ops with no proof.
- The plan artifact is already versioned + serializable
  (`packages/pg-delta-next/src/plan/artifact.ts`): `formatVersion: 1`,
  `engineVersion`, `serializePlan()`.

## What's missing (the surface to build)

1. **A stable `HazardKind` vocabulary** — the per-action booleans/enums are
   engine-internal; consumers need stable string codes they can allow-list and
   diff across versions.
2. **A hazards array in the plan artifact** — each action's hazards, plus the
   aggregate, in the serialized plan (additive — keep `formatVersion: 1`
   round-trip intact; see "format" below).
3. **A `--allow-hazards` CLI gate** — fail the plan/apply unless every present
   hazard is explicitly allowed.
4. **A CI reporter** — GitLab Code-Quality-style JSON (CLI-1464) so the hazards
   surface in MR widgets.

## Implementation plan

### 1. Derive `HazardKind` from existing Action fields (pure, no new analysis)

Add `packages/pg-delta-next/src/plan/hazards.ts`:

```ts
export type HazardKind =
  | "data_loss"            // dataLoss === "destructive"
  | "table_rewrite"        // rewriteRisk === true
  | "blocking_lock"        // lockClass === "accessExclusive"
  | "non_transactional";   // transactionality !== "transactional"

export interface Hazard { kind: HazardKind; actionIndex: number; detail: string; }
export function hazardsFor(actions: readonly Action[]): Hazard[];
```

The mapping is a pure function of fields the engine already produces — **no new
classification logic, no new per-kind code** (guardrail 3). `detail` carries the
human string (e.g. the lock class name, the dropped object id).

### 2. Attach to the artifact (additive)

Add an optional `hazards?: Hazard[]` field next to `safetyReport` in the `Plan`
type and in `serializePlan`/`deserializePlan`
(`packages/pg-delta-next/src/plan/artifact.ts`). Keep `formatVersion: 1`:
old readers ignore the extra field, new readers populate it. Only bump
`formatVersion` if a *breaking* shape change is needed (it is not).

### 3. `--allow-hazards` gate (CLI consumer)

In `packages/pg-delta-next/src/cli/commands/plan.ts` and `.../apply.ts`, add a
repeatable `--allow-hazards <kind>` flag (parsed via the existing
`packages/pg-delta-next/src/cli/flags.ts`). After planning, if any
`hazardsFor(plan.actions)` kind is not in the allow-list, exit non-zero with the
offending hazards listed. `--allow-hazards data_loss,table_rewrite` opts in
explicitly. Default = strict (no hazards allowed without opt-in).

### 4. GitLab reporter

Add `packages/pg-delta-next/src/cli/reporters/gitlab.ts` mapping `Hazard[]` →
the GitLab Code Quality JSON shape (`description`, `severity`,
`fingerprint`, `location`). Wire a `--report gitlab` flag on `plan`.

## Tests (RED first)

- **Unit** (`src/plan/hazards.test.ts`): build synthetic actions with each
  field combination, assert the exact `HazardKind[]` — including that a
  `transactional` + `none` + `share` action yields **no** hazard. Author this
  failing first.
- **Unit** (`src/plan/artifact.test.ts`): a plan with hazards round-trips
  through `serializePlan`/`deserializePlan`; a v1 artifact *without* the field
  still deserializes (back-compat).
- **CLI integration**: a plan containing a `DROP TABLE` exits non-zero without
  `--allow-hazards data_loss` and zero with it.
- Keep the rule: **never assert SQL bytes** — assert hazard kinds / exit codes.

## Effort / risk

- **Effort**: medium. Steps 1–3 are small (the data exists); the GitLab reporter
  is the longest tail.
- **Risk**: low. Additive artifact field; the gate is a pure consumer; no
  trusted-path change.

## Cross-links

- Supersedes the old engine's `packages/pg-delta/src/.../risk.ts`.
- Lock content is already vetted in `packages/pg-delta-next/src/plan/locks.ts`.
- Linear assessment: [`../pg-delta-next-linear-assessment.md`](../archive/linear-assessment.md) §1 "substrate-ready" set.
