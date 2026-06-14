# v1 correctness blocker — loud detection of unmodeled object kinds

- **Status**: 🟠 Net-new engineering, ready to start. **The one true correctness
  blocker for a v1 cut.**
- **One line**: the engine must never *silently* miss state — if a user-created
  object exists in a kind v1 doesn't model, the engine must say so, not omit it.

## The problem

`extract()` only emits facts for the kinds it models. A kind it does **not**
model is simply never queried — so a user-created object of that kind:

- never becomes a fact,
- never appears in any delta,
- is never mentioned in the plan, the proof, or any diagnostic.

The user has **no indication it was skipped.** Concretely, a custom **CAST**, a
user **operator class / family**, a **text-search configuration**, a
**statistics object** (`CREATE STATISTICS`), a user-defined **language**, or a
**transform** is silently invisible. A migration tool that silently drops part
of your schema from its view is not trustworthy — this is the gap that blocks v1.

This is verified: `src/extract/extract.ts` has a `Diagnostic` channel
(`unresolved_dependency`, `orphaned_satellite`) but **no mechanism scans the
catalog for present-but-unmodeled kinds**. The deliberate exclusions are recorded
in `COVERAGE.md` (a static doc), never checked against the actual database.

## Why this is the correctness-first priority (and the optimal stance)

The architecture's own doctrine (`target-architecture.md`, stage-2): *"extract
everything as facts at fact grain; deliberate gaps are recorded, never silently
dropped."* Today gaps are *recorded* but not *enforced against the live DB*. The
technically optimal v1 behaviour is **catalog completeness**: every object in a
managed namespace is either modeled (a fact) **or reported** (a diagnostic). v1
is then *honest* — it manages X, or it tells you it doesn't. Modeling each
missing kind is a feature (post-v1, demand-driven); **detecting** them is the
correctness floor.

## The optimal design — a catalog completeness check

Add a final pass in `extract()` that, scoped to user-managed namespaces
(exclude `pg_catalog` / `information_schema` / extension-owned via the same
`deptype='e'` / `memberOfExtension` provenance the extractor already uses),
counts objects in the kinds the engine does **not** model and emits one
`Diagnostic` per kind found:

```ts
// src/extract/unmodeled.ts  (queried in extractOnClient, appended to diagnostics)
//   code: "unmodeled_kind", severity: "warning"
//   message: `found N <kind> not managed by this engine (e.g. <names…>); v1 does not model <kind>`
```

Kinds to probe (each a small catalog count + sample names):

| Kind | Catalog | User-scope filter |
|---|---|---|
| cast | `pg_cast` | `castmethod`/source-or-target type in a user namespace, not extension-owned |
| operator | `pg_operator` | `oprnamespace` user, not extension-owned |
| operator class / family | `pg_opclass` / `pg_opfamily` | `opcnamespace`/`opfnamespace` user, not extension-owned |
| text-search config/dict/parser/template | `pg_ts_config` / `_dict` / `_parser` / `_template` | namespace user, not extension-owned |
| statistics object | `pg_statistic_ext` | `stxnamespace` user |
| language | `pg_language` | `lanispl` and not a built-in (`plpgsql`/`sql`/`c`/`internal`) |
| transform | `pg_transform` | type/lang in user scope, not extension-owned |

**Severity policy (the optimal knob, not a silent default):**

- Default: `warning` per unmodeled kind found — surfaced by `plan()` / the CLI so
  the user sees `"N unmodeled objects are not managed by this plan"`.
- Opt-in **strict mode** (`PlanOptions.onUnmodeled: "error"` or a CLI
  `--strict-coverage` flag): escalate to a hard error — refuse to produce a plan
  while unmanaged user objects exist. For environments that require the engine to
  manage the *entire* schema, strict mode makes "silent miss" impossible.

The diagnostic rides the existing `ExtractResult.diagnostics` channel; the CLI
already prints diagnostics. No new plumbing beyond the queries + the severity
gate. The completeness check is **provenance-aware**: extension-owned objects of
these kinds (already excluded by 4b / `deptype='e'`) are not reported (they're an
extension's internals, not user state) — so the warning is precise, not noisy.

## Steps (RED→GREEN)

1. **RED (integration):** create a user CAST + a user text-search config (no
   extension), `extract()`, assert a `Diagnostic` with `code: "unmodeled_kind"`
   names each kind. Fails today (no such diagnostic).
2. Add `src/extract/unmodeled.ts` (the per-kind probes, user-scope + provenance
   filters) and call it at the end of `extractOnClient`, appending diagnostics.
3. Thread an `onUnmodeled?: "warn" | "error"` through `PlanOptions` (default
   `"warn"`); in `"error"` mode `plan()` throws listing the unmodeled kinds.
   CLI: `--strict-coverage`.
4. **GREEN + regression:** assert extension-owned objects of these kinds are NOT
   reported (provenance filter); assert strict mode throws; full unit + corpus
   (no-op — corpus scenarios use only modeled kinds, so zero diagnostics).

## Tests

- Integration: user-created cast / opclass / text-search / statistics →
  `unmodeled_kind` diagnostic per kind, with names; extension-owned variant → no
  diagnostic.
- Unit: the severity gate (`warn` vs `error`) and the plan-time throw in strict
  mode.
- Corpus: unaffected (modeled kinds only → no diagnostics) — re-run to confirm.

## Effort / risk

- **Effort**: small-medium (≈7 bounded catalog probes + the severity gate +
  tests). No change to diff/plan/proof — purely additive at extract.
- **Risk**: low. Additive diagnostics; the corpus is a no-op; strict mode is
  opt-in. The only care needed is the user-scope/provenance filter so the
  warnings are precise (don't report `pg_catalog` or extension internals).

## Why this is the floor, not feature-completeness

v1 does **not** need to *model* casts/operators/etc. — that's demand-driven,
post-v1 (add an extractor + rule + corpus scenario per kind when a real schema
needs it). v1 needs to never *silently* miss them. Detection makes the deliberate
exclusions in `COVERAGE.md` **enforced and visible** instead of a footnote.
