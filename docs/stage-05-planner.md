# Stage 5: The Planner (rule table · actions · graph · compaction)

> Part of the [north-star architecture](./target-architecture.md) (§3.4–3.6).
> Depends on: stages 3–4 (the proof loop is the oracle — guardrail 5).
> Gate: corpus green under proof; differential vs old engine; generative
> soak; zero cycles. **The largest stage — plan for it to be many PRs.**

## Goal

Deltas in, ordered atomic actions out. This is where the old system's
per-kind knowledge gets its second life as data: the rule table. It is also
where the two architectural inversions live — maximal decomposition
(cycles unconstructible) and the single mixed graph (no phases, no repair).

## Deliverables

1. **The rule table** (§3.4): per-kind `KindRules` — `createTemplate`,
   `attributes` (alter / replace / conditional-replace per attribute),
   `implicitlyRemoves`, `lockClass`, `rewriteRisk`, `dataLossClass`,
   `identitySql`. Plus **global rules** (written once, first):
   comment, acl, securityLabel, membership — they have no per-kind variants
   by construction (§3.4).
2. **Action emission**: deltas × rules → atomic actions, each carrying
   `produces` / `consumes` / `destroys` fact IDs and the safety metadata.
   Multi-delta atoms (delta-set rules) for the known cases: `ALTER COLUMN
   TYPE` (column `set` + dependent invalidation), view replacement chains,
   procedure signature changes (identity change = remove+add of a
   signature-keyed fact, but rules may recognize same-name pairs).
3. **The one graph + sort** (§3.6): edges from old-state deps (teardown:
   destroyer-of-X after consumers-of-X), new-state deps (build:
   producer-of-Y before consumers-of-Y), identity conflicts (remove `X`
   before add `X`). Deterministic Kahn with a binary-heap ready queue;
   tie-break: kind weight (mine pg_dump's section ordering and the old
   `custom-constraints.ts` + pg-topo's `STATEMENT_CLASS_WEIGHT` for the
   initial table) → canonical ID. **Cycle = throw with the full
   edge-path diagnostic.** There is no breaker module to write (guardrail 4).
4. **Compaction** (§3.6): merge adjacent actions into idiomatic compound
   DDL only when no graph edge crosses the merge. Start with the two merges
   that matter for readability: column definitions into `CREATE TABLE`, and
   NOT NULL/defaults into column clauses. Everything else can stay
   decomposed until someone complains — compaction can improve forever
   without correctness risk.
5. **Plan rendering**: every action renders one SQL statement. Mine the old
   serializers (`changes/*.ts` templates, `table.alter.ts`'s ~25 variants)
   for the SQL-shape knowledge — port the *strings*, not the class
   structure.

## Recommended PR sequence (each lands corpus-greens, flips `EXPECTED_RED` entries)

1. **Skeleton + global metadata rules** — comment/acl/label/membership
   over any kind whose create/drop exists; prove on trivial scenarios.
2. **Bootstrap kinds**: schema, role, extension (+ provenance-aware
   behavior), language. Simple creates/drops/alters; exercises the graph
   end-to-end.
3. **The relation core**: table, column, constraint, default, index,
   sequence. This PR (or PR series) is the heart — decomposed emission
   means `CREATE TABLE` bare + per-column/constraint actions, FK actions
   always separate. The old cycle-breaker scenarios in the corpus
   (dropped-table FK cycles, publication-column cycles) must sort
   **cycle-free by construction** here; if one cycles, the emission isn't
   decomposed enough — fix emission, never add repair.
4. **Routine kinds**: procedure/function (signature identity), aggregate,
   trigger, rule, policy. `check_function_bodies = off` as a plan session
   setting (port from old `create.ts:350`).
5. **View family**: view, materialized view — replacement chains via
   delta-set rules; dependent rebuild ordering comes from edges, verify
   against the corpus's policy/view recreation scenarios.
6. **The long tail**: domain, collation, types (enum/composite/range),
   publication, subscription, FDW family, event trigger.
7. **Compaction pass** last — it's cosmetic; prove output stability
   (compaction never changes proof results, asserted by running the corpus
   both ways).

## Mining map (old → new)

| Old location | What to extract |
|---|---|
| `objects/*/changes/*.ts` | SQL templates per action |
| `objects/*/*.diff.ts` | conditional knowledge: when ALTER vs replace (e.g. `table.diff.ts` constraint mutation logic) → `attributes` rules |
| `expand-replace-dependencies.ts` | the replacement-closure semantics → delta-set rules + edges |
| `post-diff-normalization.ts` | each pass encodes an implicit-cascade fact → `implicitlyRemoves` entries |
| `sort/cycle-breakers.ts` | each breaker is a corpus scenario that must now be unconstructible — verification targets, not code to port |
| `sort/custom-constraints.ts`, pg-topo `topo-sort.ts` weights | initial kind-weight table |
| `plan/risk.ts` | data-loss classification seed |

## What to look for (pitfalls)

- **Rule-vocabulary creep toward code.** The moment a rule wants a 50-line
  function, stop: either the payload is mis-shaped (stage 2 fix), the case
  needs a named sub-rule form (extend the vocabulary, log the decision), or
  it's two rules. Guardrail 3 is absolute.
- **Differential triage discipline.** Old and new engines will diverge
  constantly at first. Every divergence gets bucketed (`new-bug` /
  `old-bug` / `accepted-difference`) with a reason — accepted-differences
  become release-notes material for stage 10; old-bugs become new corpus
  scenarios.
- **Identity conflicts beyond names**: remove+add of the *same* ID is a
  replace (order: remove first); remove+add where only the signature
  differs (procedures) needs the delta-set rule, or you'll emit
  collision-prone CREATE before DROP.
- **Don't optimize the graph build.** O(deltas) construction over indexed
  edges falls out naturally here — the old engine's O(catalog) scan was a
  consequence of its shape, not something to "fix" again.
- **Minimality assertions**: as kinds land, add `expect.actions` /
  `maxActions` to the corpus scenarios where drop+create-instead-of-alter
  would be silent (the proof can't see non-minimality — §3.7).

## Gate

- Corpus fully green under proof (state + data preservation) on all PG
  versions — `EXPECTED_RED` is empty for engine tests.
- Differential vs old engine: zero untriaged divergences.
- Generative soak: an agreed run-count (e.g. 10k generated roundtrips)
  with zero proof failures and zero cycles.
- Zero cycle errors across corpus + soak (guardrail 4 holds with no
  exceptions needed).
