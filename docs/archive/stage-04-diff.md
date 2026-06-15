# Stage 4: Generic Diff

> Part of the [north-star architecture](../architecture/target-architecture.md) (§3.3).
> Depends on: stage 1 (rollups), stage 2 (real fact bases to test against).
> Gate: fixture diffs; `diff(A, A) = ∅` generatively.

## Goal

The smallest stage, by design: rollup-guided descent over two fact bases,
emitting fact-level deltas. There is **zero per-kind code here** — if a kind
needs special handling during diff, that's a payload-definition problem
(stage 2) or a rule problem (stage 5), never a diff problem. Guard that
boundary jealously; it is the structural guarantee behind P2.

## Deliverables

1. **`diff(a: FactBase, b: FactBase): Delta[]`** implementing:
   - Compare root rollups; equal → `[]`.
   - Descend the parent tree: rollup-equal subtrees skipped wholesale;
     differing facts compared by payload hash; differing payloads compared
     attribute-by-attribute → `set` deltas; presence differences → `add` /
     `remove` (with the whole subtree of a removed/added container emitted
     as facts — the planner decides what's implicit).
   - Edge set differences → `link` / `unlink` deltas.
2. **Deterministic output order**: sorted by canonical ID encoding, then
   verb. Determinism here is what makes plans reproducible artifacts.
3. **Delta serialization** — deltas are the plan payload (§3.7); they
   serialize/deserialize losslessly alongside the snapshot format.

## How to proceed

1. Unit tests on hand-built fact bases first (no database): every verb,
   nesting, edge-only changes, the empty cases.
2. Property tests: `diff(A, A) = ∅` over generated fact bases;
   `diff(A, B)` and `diff(B, A)` are verb-mirrored; applying a delta list
   to `A`'s fact set reproduces `B`'s fact set exactly (a pure-data "apply"
   used only for testing the differ — do not confuse it with SQL apply).
3. Then corpus-derived fixtures: extract real `(A, B)` pairs via the
   stage-3 harness, snapshot them, and assert interesting deltas (these
   become the fast Docker-free diff tests the architecture promised).

## What to look for (pitfalls)

- **The temptation to interpret.** "A removed table should suppress its
  column removes" is planner knowledge (`implicitlyRemoves`), not diff
  logic. The differ reports the full truth; the rule table decides
  significance.
- **Attribute-level `set` granularity** depends on payload schema shape:
  an attribute that is itself a blob (a `pg_get_*def` string) diffs as one
  `set` — that's correct and intended; don't decompose definition strings.
- **Set-valued attributes** must have been sorted at extraction (stage 2's
  contract). If a flapping diff shows up, fix the payload normalization,
  not the differ.
- **Performance is free here** — O(changed) falls out of rollups. Resist
  adding caching or indexes until a profile demands it.

## Gate

- Unit + property suites green (no Docker).
- Corpus-derived diff fixtures green.
- `diff(A, A) = ∅` holds generatively over stage-3's generator output.
- The differ contains no reference to any concrete fact kind (enforced by
  a test that greps the module for kind names — crude, effective).
