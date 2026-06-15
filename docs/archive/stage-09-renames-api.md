# Stage 9: Renames + Public API & CLI

> Part of the [north-star architecture](../architecture/target-architecture.md) (§4.1,
> §4.2, §4.5). Depends on: stages 5–7 (planner, artifacts; stage 7's
> `loadSqlFiles` is what the export round-trip gate runs through); stage 1
> designed the structural rollup this stage uses. Gate: rename corpus;
> export round-trip; API review.

## Goal

The visible payoff stage: rename detection (the data-preserving feature no
comparable tool ships) and the finalized public surface — library API and
CLI — that consumers will actually touch.

## Deliverables — renames

1. **Candidate matching.** Over the diff's `remove`/`add` pairs:
   - *Leaf renames*: same payload hash + same parent + same kind, different
     name → candidate (`ALTER … RENAME`). Columns are the prize — they're
     the case that destroys data in practice.
   - *Container renames*: same **structural rollup** (the identity-free
     fold from stage 1) + same kind → candidate; the rename rewrites the
     whole subtree's IDs without emitting subtree actions.
   - Ambiguity (n removed candidates × m added with equal hashes): never
     guess — group them in the verdict for the policy to resolve.
2. **Policy gate**: `renames: "auto" | "prompt" | "off"` on plan creation.
   `auto` applies only unambiguous candidates; `prompt` surfaces candidates
   in the plan artifact as questions (CLI renders them interactively;
   library callers answer programmatically); `off` preserves drop+create.
   Default: `prompt` in the CLI, `off` in the library (legibility for
   programmatic consumers; revisit after field experience).
3. **Proof integration**: a rename action must pass data preservation
   trivially (the rows survive *because* it's a rename) — corpus scenarios
   assert both the rename emission (`expect.actions`) and seeded-row
   survival, plus the degradation case (hash-unequal "rename" stays
   drop+create with `dataLoss` honestly reported).
4. **Known limits, documented in output**: payloads referencing other
   objects by name (FK constraints naming the renamed table) break
   transitive hash equality (§4.1) — candidates degrade to drop+create,
   never the reverse; the verdict says why when a near-miss occurred
   (same structural rollup except name-bearing payloads).

## Deliverables — API & CLI

5. **Public API finalized** around the layers, each independently usable:

   ```text
   extract(pool | url, opts)          -> FactBase
   loadSqlFiles(roots, shadow)        -> FactBase        (stage 7)
   loadSnapshot(path)                 -> FactBase
   diff(a, b)                         -> Delta[]
   plan(a, b, {policy?, renames?})    -> Plan             (artifact, stage 6)
   provePlan(plan, source, desired)   -> ProofVerdict
   apply(plan, target, opts)          -> ApplyReport
   ```

   Subpath exports per layer; the root is a facade over the common path.
   API review = a written pass over every exported name/type against the
   architecture doc's vocabulary (facts, deltas, actions, proof — no legacy
   terms like "catalog"/"changes" leaking through).
6. **Declarative export** — `exportSqlFiles(fb, mapping): FileTree`: render
   the fact base via the stage-6 renderer and split the statements across
   files by a mapping policy (kind/schema-driven paths — mine the old
   `export/file-mapper.ts` for the layout users already know). Export
   fidelity is provable, not aspirational:
   `loadSqlFiles(exportSqlFiles(fb)) ≡ fb` hash-identically — the corpus
   gains round-trip scenarios asserting exactly that, which closes the
   declarative loop: export → hand-edit → apply is the same proof-covered
   path in both directions.
7. **Drift detection, surfaced.** The §4.2 capability is a rollup-hash walk
   the engine already does — this stage makes it a product feature:
   `diff(extract(env), loadSnapshot(pinned))` exposed as a CLI verb
   (`pgdelta drift <env> <snapshot>`) reporting changed/added/removed facts.
   Without this deliverable the capability silently dies in the engine.
8. **CLI v2**, a thin consumer of the public API: `plan`, `apply`, `prove`,
   `diff`, `drift`, `schema export` (fact base → declarative files via
   renderer), `schema apply` (files → shadow → plan → apply), `snapshot`
   (fact base → file; replaces the old `catalog-export`). Interactive
   rename prompts; policy selection by name/path; plan artifacts as files.
   The old CLI's command vocabulary is a reference, not a contract — the
   mapping table must cover all six old commands explicitly, including
   `sync` (→ `plan` + `apply` in one invocation) and `catalog-export`
   (→ `snapshot`).

## What to look for (pitfalls)

- **Rename vs replace identity collisions**: a rename candidate whose
  target name also exists in the source is a swap/chain — out of scope for
  `auto` (force prompt); cover with a corpus scenario so it can't sneak
  into auto.
- **Renames × policy filtering** (stage 8): a candidate where one side is
  policy-filtered must not surface — match after filtering.
- **API stability budget**: this is the last stage before cutover freezes
  v1 of the surface; anything exported here is a multi-year commitment.
  When in doubt, don't export.

## Gate

- Rename corpus green: leaf rename, container rename, ambiguous pair
  (prompt), near-miss degradation, swap case, seeded-row survival on every
  auto rename.
- Export round-trip green: `load(export(fb)) ≡ fb` over the corpus's
  schemas (and the exported tree loads with zero deferred rounds — exports
  are emitted pre-ordered).
- API review completed and recorded (a checklist in the PR, name by name).
- Drift verb demonstrated: a mutated environment vs a pinned snapshot
  reports exactly the mutated facts.
- CLI v2 covers the old CLI's workflows (mapping table covering all six
  old commands), demonstrated against the corpus's happy-path scenarios.
