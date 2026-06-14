# The managed-view architecture (canonical)

- **Status**: Canonical design. **Supersedes** the scope/serialize portions of
  [`target-architecture.md`](target-architecture.md) §3.9, and replaces the two
  Tier-3 stubs ([object-filtering-flags](remaining-work/tier-3-object-filtering-flags.md),
  parts of [service-migration-baselines](remaining-work/tier-3-service-migration-baselines.md))
  with a single model.
- **Scope**: `packages/pg-delta-next` only. This is a from-scratch design of how
  *context* (scope, ownership, applier identity) enters the engine — not a
  migration of the existing scope/serialize code.
- **Date**: 2026-06-14.

## The one idea

> **The engine never diffs raw catalogs. It diffs a policy-defined,
> applier-capability-restricted _view_ of the managed universe — and a view is
> closed under the proof loop.**

Everything previously handled by three inconsistent mechanisms — fact-level
projection (`excludeManaged`/`excludeExtensionMembers`), delta-level filtering
(`filterDeltas`), and serialize escape-hatch params (`skipAuthorization`,
`skipSchema`) — collapses into one: **define the view, diff the view, prove the
view.**

```
            raw source ─┐                          ┌─ raw desired
                        ▼                          ▼
                  view(facts, policy, capability)        ◀── ONE definition
                        │                          │
              effectiveSource ──── diff ──── effectiveDesired
                        │
                     deltas ── rules ── actions ── graph ── sort ── apply
                        │
                     provePlan  (re-extract is run through the SAME view)
```

## Why this is forced by the constraints (not a preference)

| Constraint (from target-architecture) | What it forces |
|---|---|
| **Proof honesty: `plan == prove == run`** | A single **fact grain**. Filtering *after* the diff breaks honesty (the plan target ≠ the desired fact base), which is why the old design needed `projectTarget` to rebuild a synthetic target and the missing-requirement guard's *"a filter may be hiding its creation"* branch to catch stranded references. A view defined *before* the diff is honest by construction — nothing to repair. The constraint doesn't permit single-grain, it **selects** it. |
| **§3.1 "provenance is data — an edge, not a flag"** | Ownership and scope are **edges and facts**, never serialize toggles. |
| **One graph / no per-kind code in the planner body** | The view *decisions* are generic; per-kind *rendering* (e.g. `AUTHORIZATION` vs `OWNER TO`) stays in the rule table, where it is allowed. |
| **"Source it from the catalog, don't invent a second source of truth"** | A render flag that describes the object (`skipSchema`) is a **missing fact field** (`pg_extension.extrelocatable`), not a policy constant. |

## The four structural moves

### 1. Ownership becomes an edge (`ownedBy`), not a payload string

Today `schema.create` reads a payload `owner`, emits `AUTHORIZATION <owner>` +
`consumes: role`, and `skipAuthorization` (rules.ts:584) suppresses the clause.

**New model:** ownership is an edge `object --ownedBy--> role`, emitted by the
extractor wherever `pg_catalog` has an owner column (`nspowner`, `relowner`,
`proowner`, `typowner`, …). Consequences, all structural:

- Projecting a role out of the view **prunes the `ownedBy` edges to it
  automatically** — the projection already "prunes edges with removed
  endpoints." A surviving object whose owner is out of scope simply has no
  in-scope `ownedBy` edge.
- A create/alter rule renders owner **iff an in-scope `ownedBy` edge exists**.
  No edge → no clause. **`skipAuthorization` ceases to exist** as a structural
  consequence of edge pruning — it is not "fixed," it is gone.
- Owner *changes* become edge deltas (`unlink`/`link` → `ALTER … OWNER TO`),
  and owner becomes **rename-aware**, uniformly, for every ownable kind.
- Per-kind owner SQL (`AUTHORIZATION` inline for schema; `OWNER TO` follow-up
  action for most kinds, compactable into the create like column folds) lives in
  the rule table. The planner holds no owner logic.

### 2. Object-intrinsic render flags become fact fields, from the catalog

`skipSchema` (rules.ts:604) encodes a property of the *extension*
(`pg_extension.extrelocatable`) that was never extracted, so the policy
hardcodes the answer (`["pgmq","pgsodium","pgtle"]`).

**New model:** extract `extrelocatable` onto the `extension` fact. The extension
rule emits `SCHEMA` **iff the extension is relocatable**. No param, no name list,
**not Supabase-specific** — correct for PostGIS, uuid-ossp, anyone. (A
non-relocatable extension creates its own schema; a relocatable one is the only
kind that honours a `SCHEMA` clause.)

*Principle: a serialize param that describes the object is a missing fact field.*

### 3. Applier capability becomes a probed fact; the view is capability-restricted

This is the irreducible residue, and the genuinely new idea. `skipAuthorization`'s
*real* cause is not the schema — it is that **the applier cannot become that
role**. The FDW-ACL exclusion (Supabase Rule 9) has the identical shape: **the
applier is not superuser**, so `GRANT ON FOREIGN DATA WRAPPER` is unexecutable.
Neither is derivable from the object catalog or from scope — both are properties
of **who is applying**.

**New model:** probe the applier's capabilities at connect time and represent
them as facts — exactly as the schema is extracted:

```ts
interface ApplierCapability {
  role: string;
  isSuperuser: boolean;
  memberOf: ReadonlySet<string>;   // roles the applier can SET ROLE to
  // derived helpers:
  canActAs(role: string): boolean;          // isSuperuser || memberOf.has(role)
  canGrantOn(kind: FactKind): boolean;      // superuser-gated kinds (fdw, …)
}
```

The view is then `view(facts, policy, capability)`, and capability-blocked
operations are **projected out of the view with a reported diagnostic, never
silently**. `skipAuthorization` and the FDW-ACL rule both *derive* from one
probed capability model instead of being hand-set per platform. For a pure
file-to-file diff with no applier connection, capability defaults to
"unrestricted" and apply-time failures surface loudly (documented).

### 4. Filtering collapses to one grain

The policy DSL **survives unchanged as composable data**; only its *compilation
target* changes — it compiles to a view transformation, not a post-diff filter.

- **Scope rules (no `verb`)** — "exclude system schemas / system-role-owned /
  satellites on managed objects" (Supabase Rules 4,5,6,7,10) — become
  **fact-level projections** on both sides. Satellites and owner-edges then
  follow their target out *by pruning*, so Rules 5/7/10 evaporate (a satellite
  rides out with its parent automatically). **Stranding is impossible here.**
- **Operation rules (`verb`-bearing)** — "never DROP this", "create-only" — are
  the only rules that need the diff, and each reduces to a **pre-diff adjustment
  of the desired view relative to source**: `don't-drop` = copy the fact into
  desired; `don't-create` = remove it from desired; `don't-alter` = pin source's
  value. This is precisely what `projectTarget` computes — now run on an
  already-scope-projected base, so it can strand **only** a genuine policy
  conflict (you pinned a dependent but excluded its dependency).

The missing-requirement guard stays, but its meaning **sharpens** from "the
mechanism stranded a reference" to "your policy is internally inconsistent" —
which is exactly when it should fire.

## The durable principle (prevents regression)

> A serialize param is legitimate **iff** it encodes an *apply-time strategy*.
> - Describes the **object** → it is a **fact field** (sourced from the catalog).
> - Describes **what is in scope** → it is an **edge + projection**.
> - Describes **who is applying** → it is **probed capability**.

By that test, `concurrentIndexes` is the **only** legitimate serialize param.
`KNOWN_PARAMS` ends at `{ "concurrentIndexes" }`.

## What collapses

| Today | New | Why it disappears |
|---|---|---|
| `skipSchema` param + 3-name list | `extrelocatable` fact field | object-intrinsic → field |
| `skipAuthorization` param | `ownedBy` edge pruning + capability | scope/capability, not a flag |
| FDW-ACL exclude (Supabase Rule 9) | probed-capability projection | same class as skipAuthorization |
| schema / owner / satellite excludes (Rules 4,5,6,7,10) | fact-level projection + edge pruning | scope is a view; satellites follow parents |
| `excludeManaged` + `excludeExtensionMembers` + `filterDeltas` (3 entry points) | one `resolveView(...)` | one grain, one definition |
| `projectTarget` for scope rules | gone (scope is pre-diff) | honesty by construction |
| guard's "a filter may be hiding its creation" branch | gone | scope can't strand; only real conflicts remain |

## The new pipeline (concrete)

```ts
// One definition, used by plan() and the proof re-extract identically.
function resolveView(
  raw: FactBase,
  policy: Policy | undefined,
  capability: ApplierCapability | undefined,
): FactBase;  // pure existence/identity/provenance/capability projection (no verb)

// Operation (verb) rules act on the diff of two resolved views:
function applyOperationRules(
  deltas: Delta[],
  source: FactBase,        // resolved
  desired: FactBase,       // resolved
  policy: Policy | undefined,
): { kept: Delta[]; reverted: Delta[] };  // == old projectTarget, minimized

function plan(rawSource, rawDesired, options) {
  const cap = options?.capability;
  const source  = resolveView(rawSource,  options?.policy, cap);
  const desired = resolveView(rawDesired, options?.policy, cap);
  const all = diff(source, desired);
  const { kept, reverted } = applyOperationRules(all, source, desired, options?.policy);
  const target = revertInto(desired, reverted);   // plan target == proof target
  // … rules → actions → graph → sort, as today
}
```

- `excludeManaged` / `excludeExtensionMembers` become two *cases* inside
  `resolveView` (they are scope projections by the `managedBy` / `memberOfExtension`
  edges). The Supabase scope rules are more cases. One code path.
- The proof loop’s `reextract` is wrapped in the same `resolveView` so
  `plan == prove == run` holds with no special-casing.

## Costs (kept honest)

- **+1 edge per ownable object.** Ownership-as-edge grows the edge set
  (≈ one per table/view/sequence/type/function/schema). Cheap per edge; buys
  uniform owner-diff + owner-rename. Real, accepted.
- **Capability probing is new extraction** (role membership + superuser) and a
  new optional *input*. Absent (file-only diff), default to unrestricted.
- **Operation (verb) rules still need a post-diff revert** — `projectTarget`
  shrinks to this minority; it does not vanish entirely. Stated, not oversold.
- **`idField` + glob** (membership / pgmq-table matcher) survives as the one
  stringly-typed predicate; the target for future structural replacement.

## Build sequence (each step RED→GREEN, no old/new coexistence)

This is a build order, not a migration — the old scope/serialize code is
replaced in place.

> **Reordering note (discovered during implementation).** Owner-as-edge's
> *skipAuthorization elimination* relies on **fact-level role projection pruning
> the owner edge**, which is the view foundation; and turning an `owner` edge
> link/unlink into an `ALTER … OWNER TO` action is **brand-new core machinery**
> (today `link`/`unlink` deltas are emitted by `diff` but ignored by the planner
> — edges only drive ordering). So the view foundation is built **before**
> owner-as-edge. The ordering below reflects that.

1. ✅ **`extrelocatable` → derive `SCHEMA`; delete `skipSchema`.** Extractor
   field + extension-rule conditional. (shipped `6b74b7d`)
2. ✅ **Projection primitive** — `excludeByProvenance` / `excludeFactsAndDescendants`
   in `policy/view.ts`; `excludeManaged` + `excludeExtensionMembers` collapse
   into it. The fact-level foundation. (shipped `d1883e9`)
3. ✅ **`resolveView`**: non-`verb` policy rules → fact-level projection on both
   sides + the proof reextract; `verb` rules left to the delta-level filter.
   First-match-wins with over-projection safety (an operation-`include` protects
   a fact a later scope-`exclude` would remove). (shipped `96fe441`, corpus 418/418)
4. ✅ **`owner` edge + edge→action**: extractor emits an `owner` edge and drops
   the payload `owner`; the planner emits `ALTER … OWNER TO` from `owner`-edge
   link deltas (`KindRules.ownerAlterPrefix`); `diff.emitSubtree` emits edge
   deltas for created/dropped subtrees; the `{ owner }` predicate resolves via
   the edge; `skipAuthorization` deleted. (shipped `d840768`, corpus 418/418)
5. ✅ **`applyOperationRules` — SUBSUMED by 3 + 4.** No separate change is
   correct. After 3, `projectTarget` already handles only the `verb`-filtered
   deltas (scope rules produce no filtered deltas — they're projected), and the
   missing-requirement guard is already **conflict-only** (scope can't strand;
   only a `verb` rule, e.g. don't-create a kept object's dependency, fires it —
   pinned by policy.test.ts test 3). A clean "verb-only" delta pass is **not**
   achievable: `resolveView` conservatively KEEPS facts protected by an
   operation-`include`, so their non-protected deltas still need the full policy
   at the delta level. The current `resolveView` + full `filterDeltas` +
   minimized `projectTarget` IS the end state.
6. **`ApplierCapability`** (remaining): probe the applier's role / superuser /
   memberships; restrict the view (capability-blocked ops projected out with a
   reported diagnostic); derive the FDW-ACL exclusion. Additive — keep the
   working Supabase Rule 9 until the derivation is proven at parity.
7. **Cleanup** (remaining): `KNOWN_PARAMS = { concurrentIndexes }` ✅ (move 4);
   update `COVERAGE.md` + the Supabase policy comment block. NOTE: Rules 5
   (schema-name), 7 (role-name) and 10 (satellite-on-system-target) are **genuine
   scope rules that stay** — they are now applied fact-level via `resolveView`,
   not deleted. Only Old-13 (skipAuthorization) and Old-14 (skipSchema) were
   removed.

End state: the policy DSL describes a view; the engine diffs `view(source)`
against `view(desired)`; the proof re-extracts through the same view; serialize
params hold only apply-strategy; and there is **zero Supabase-specific knowledge
in core.**
