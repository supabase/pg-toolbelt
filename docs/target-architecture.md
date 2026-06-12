# Target Architecture: pg-delta & pg-topo

- **Status**: Proposal for team review
- **Date**: 2026-06-12
- **Baseline**: commit `115dde8` (`pg-delta@1.0.0-alpha.28`, `pg-topo@1.0.0-alpha.1`)
- **Scope**: architecture roadmap only — no code changes ship with this document

This document records the outcome of a full architecture review of the two core
packages, the decisions taken, and a phased roadmap. Every code claim carries a
`path:line` citation verified against the baseline commit. It is a decision
record, not a menu: each topic ends in one recommendation; rejected
alternatives get one line.

---

## 1. Executive summary

pg-delta's pipeline is correct and well-layered. Extraction, diffing,
dependency expansion, normalization, sorting, serialization, and apply are
cleanly separated; dependency edges come from `pg_depend` (authoritative)
rather than SQL re-parsing; the sort layer's cycle-handling doctrine
(`packages/pg-delta/CLAUDE.md`) is hard-won and right. None of that changes.

The review found four problems, in decreasing severity:

1. **A latent correctness bug**: catalog extraction runs ~28 queries on
   different pool connections with no shared snapshot, so the catalog and its
   `pg_depend` edges can be mutually inconsistent under concurrent DDL
   (§3.1).
2. **Built for hundreds of objects, not 10k+**: object equality is a double
   `JSON.stringify` per pair per diff (§3.2); the sort layer scans the entire
   catalog's dependency rows regardless of diff size and rebuilds its graph
   from scratch on every cycle-break round (§3.3); the topological queue is
   O(V²) (§3.3).
3. **~40% of the code is mechanical boilerplate**: `src/core/objects/` is 256
   source files / 31,162 LOC (plus 127 test files / 18,505 LOC) across 21
   object-type directories and 106 change classes, of which roughly 65% are
   structurally identical (§4).
4. **Library consumers pay for the CLI and a WASM parser**: `@supabase/pg-topo`
   (→ libpg-query WASM), `@stricli/core`, and `chalk` are hard `dependencies`
   of the library even for pure `createPlan` users
   ([package.json:80-89](../packages/pg-delta/package.json)) (§5).

The target architecture keeps the pipeline shape and every public contract
that matters (stable-ID wire format, plan fingerprints, the
`creates/drops/requires/invalidates` + `serialize()` change contract) and
changes how the stages are implemented:

| Track | Change | Headline outcome |
|---|---|---|
| Correctness & perf (§3) | Snapshot-consistent parallel extraction; content-hash equality; single-build sort with depend pre-filtering | Consistency bug fixed; diff 5–20× faster; tiny-diff-vs-huge-catalog goes from O(catalog) to ~O(changes) |
| Simplicity (§4) | Typed stable IDs; one generic `Change` family; `ObjectTypeSpec` registry + one generic diff engine | −11–12K source LOC, ~150 fewer files; new object types become ~1 spec file |
| API & packaging (§5) | Layered subpath exports; pg-topo becomes optional (dynamic import) | WASM-free core install; `diffCatalogs`/`sortChanges` independently usable |
| Test & CI velocity (§6) | Template databases; catalog-fixture unit diffs replacing most Docker tests | 2–5× wall-clock; the 45-job integration matrix shrinks structurally |
| Declarative (§7) | Converge on shadow-DB diff; round-based apply becomes the fallback | One trusted ordering engine (`pg_depend`); pg-topo narrows to dev-time ordering/validation |

Decisions already taken (with maintainer sign-off): roadmap-first delivery;
**moderate** packaging (no new packages — the five-package split and a shared
`pg-graph` kernel were evaluated and rejected, §5.3); **shadow-DB
convergence** for declarative apply (§7).

---

## 2. What stays (explicitly)

A review that only lists changes invites accidental regressions of good
decisions. The following are load-bearing and deliberately **unchanged**:

- **The seven-stage pipeline shape**: extract → diff → expand-replace →
  normalize → sort → serialize → apply, and the change contract — every
  change exposes `creates` / `drops` / `requires` / `invalidates` (stable-ID
  string arrays) plus `serialize(options?)`
  ([base.change.ts](../packages/pg-delta/src/core/objects/base.change.ts)).
  The sort/plan/apply layers already consume *only* this contract; that is
  precisely what makes the simplicity track (§4) low-risk.
- **The sort module's architecture.** Two-phase ordering (drops in reverse
  topological order, then creates/alters forward), a generic graph builder,
  weak-edge filtering, and cycle-breaking by change injection. The decision
  tree for *where* cycle handling lives (object-local diff vs post-diff
  normalization vs sort-phase injection vs `invalidates`) documented in
  `packages/pg-delta/CLAUDE.md` stays canonical. §3.4 tunes data structures
  inside this design; it does not redesign it.
- **`pg_depend` at extract time as the only dependency source** for the core
  diff path. No SQL parser ever enters the diffing path. This constraint has
  repeatedly proven itself (expression-level dependencies that parsers miss,
  Postgres-version drift) and is the foundation of §7's recommendation.
- **Zod model schemas and per-type extractor SQL** in `<type>.model.ts`. They
  encode real per-version `pg_catalog` knowledge. The registry (§4.3)
  references extractors; it does not replace them.
- **Bespoke diff/serialize for the genuinely complex types** — table
  (3,528 LOC including a 975-line `table.alter.ts` with ~25 ALTER variants),
  procedure (signature-keyed identity), view/materialized-view
  (replace-vs-alter, dependency reconstruction). These are escape hatches in
  the registry, never templated.
- **Full in-memory catalog materialization.** At 10k objects the catalog is
  tens of MB — trivial. Streaming/lazy diffing would forfeit cross-type
  dependency resolution and fingerprinting for no measurable win below ~100k
  objects. Explicitly rejected as premature.
- **Sequential single-transaction apply**
  ([apply.ts:125-131](../packages/pg-delta/src/core/plan/apply.ts)). Parallel
  DDL apply is rejected: DDL takes `ACCESS EXCLUSIVE` locks, would deadlock on
  shared catalogs, and would break the transaction as the atomicity boundary.
  The topological order exists exactly so that serial execution is safe.
- **The pg-delta / pg-topo identity duplication is deliberate.** pg-delta's
  stable IDs (`table:public.users`) are a *catalog-exact wire format*,
  persisted in plan fingerprints and matched against `pg_depend`-derived rows.
  pg-topo's `ObjectRef` is a *lexical-approximate* identity recovered from
  parsed SQL (quoted-identifier normalization, signature inference,
  builtin-type filtering). The packages also differ in cycle policy: pg-delta
  rewrites cycles (change injection); pg-topo reports them (diagnostics).
  Unifying these would force the exact world to carry the approximate world's
  fuzzy-matching semantics. Future contributors should not "DRY" them
  together.

---

## 3. Correctness & performance track

### 3.1 Snapshot-consistent parallel extraction

**Problem.** `extractCatalog` fires ~28 extractors via `Promise.all` over a
`pg.Pool`
([catalog.model.ts:352-381](../packages/pg-delta/src/core/catalog.model.ts))
whose default size is 5
([postgres-config.ts:108](../packages/pg-delta/src/core/postgres-config.ts)).
Each query lands on whatever connection frees up, at a different wall-clock
time, with no shared transaction. Consequences:

- **Correctness**: the object queries and the `pg_depend` query
  ([depend.ts:511](../packages/pg-delta/src/core/depend.ts)) can observe
  different database states under concurrent DDL. The result is a catalog
  whose dependency rows reference objects the catalog doesn't contain (or
  vice versa). The `unknown:` filter in
  [graph-builder.ts:26-33](../packages/pg-delta/src/core/sort/graph-builder.ts)
  silently drops such edges — masking the symptom, losing real ordering
  information.
- **Latency**: 28+ queries contending for 5 connections ≈ six serial waves,
  and each of the heavy queries (`pg_get_*def`, `aclexplode`, lateral joins)
  pays planning and queueing overhead. `applyPlan` runs **three full
  extractions** per apply: source + target up front
  ([apply.ts:83-86](../packages/pg-delta/src/core/plan/apply.ts)) and a
  post-apply verification extract
  ([apply.ts:138-152](../packages/pg-delta/src/core/plan/apply.ts)).

**Target.** The pg_dump-parallel model — one exported snapshot, N workers:

```ts
// catalog.model.ts (sketch)
const lead = await pool.connect();
await lead.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
const { rows: [{ snap }] } = await lead.query("SELECT pg_export_snapshot() AS snap");

const runExtractor = async <T>(extract: (c: ClientLike) => Promise<T>) => {
  const worker = await pool.connect();
  await worker.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await worker.query(`SET TRANSACTION SNAPSHOT '${snap}'`);
  try { return await extract(worker); }
  finally { await worker.query("COMMIT"); worker.release(); }
};
// run all extractors (objects + depends + version + user) with bounded
// concurrency over the same snapshot, then COMMIT + release the lead.
```

Every extractor sees the exact same database state; parallelism is preserved
(and improves, since the pool default rises to match the worker count). This
is days of work and fixes the bug outright.

**Second step, only if profiling justifies it**: collapse the per-type queries
into ~6 "object family" queries returning `jsonb_agg` rows (relations,
routines, types, security, replication, misc), cutting round-trips ~5×. A
single mega-query is rejected — planner-hostile and unmaintainable.

**Also**: make the post-apply verification extract **opt-in** instead of
opt-out (today it runs unless `verifyPostApply: false`,
[apply.ts:138](../packages/pg-delta/src/core/plan/apply.ts)). The plan's
fingerprint contract already guards pre-apply state; the third extraction is a
paranoia check that belongs in CI, not in every production apply. One-third
fewer extractions per apply.

### 3.2 Content-hash equality

**Problem.** `BasePgModel.equals`
([base.model.ts:70-75](../packages/pg-delta/src/core/objects/base.model.ts))
delegates to `deepEqual`, which is
`stringifyWithBigInt(a) === stringifyWithBigInt(b)`
([objects/utils.ts:36-37](../packages/pg-delta/src/core/objects/utils.ts)) —
a full recursive `JSON.stringify` of both sides, recomputed for every shared
object on every diff. For a table model (columns, constraints, privileges,
security labels) that is a deep tree. At 10k shared objects, this dominates
diff CPU. `table.diff.ts` already works around it locally with
cheap-scalar-first comparisons — evidence the cost is real.

**Target.** A memoized content hash on the base model:

```ts
// base.model.ts (sketch)
abstract class BasePgModel {
  #contentHash?: string;
  get contentHash(): string {
    return (this.#contentHash ??= hashCanonical(this.stableSnapshot().data));
  }
  equals(other: BasePgModel): boolean {
    return this.stableId === other.stableId
        && this.contentHash === other.contentHash;
  }
}
```

`hashCanonical` = canonical serialization (sorted keys, bigint-safe — the
existing `stringifyWithBigInt` semantics) fed to a fast non-cryptographic hash
(xxhash64 or FNV-1a). The hash is computed once per object, lazily, and
overlaps with extraction I/O wait. `stableSnapshot()` is already the correct
equality surface — subclasses override it to drop unstable fields (the
"physical attnums vs logical names" rule), so the hash inherits every
normalization for free.

Two integration points:

- `fingerprint.ts` already canonically stringifies models for plan
  fingerprints; feed it the same canonical string so the work is shared (keep
  SHA-256 there — fingerprints cross machine boundaries).
- Keep `table.diff.ts`'s scalar fast paths: they classify *what kind* of
  ALTER to emit for objects already known to differ. The hash replaces only
  the *are-they-equal* gate.

Diff becomes O(n) 8-byte compares. Expected 5–20× on the diff stage at scale.

### 3.3 Sort: build once, scan only what changed

**Problems** (all in `src/core/sort/`):

1. `convertCatalogDependenciesToConstraints` iterates **every** `pg_depend`
   row in the catalog on every sort
   ([graph-builder.ts:26](../packages/pg-delta/src/core/sort/graph-builder.ts)),
   regardless of how many changes are being sorted. A one-change diff against
   a 10k-object catalog (≈100k+ depend rows) pays the full scan — twice, once
   per phase.
2. `sortPhaseChanges` re-invokes `attemptSortRound` from scratch after every
   cycle-breaking change injection
   ([sort-changes.ts:259-289](../packages/pg-delta/src/core/sort/sort-changes.ts)),
   and `attemptSortRound` rebuilds all graph data each call
   ([sort-changes.ts:161-167](../packages/pg-delta/src/core/sort/sort-changes.ts)).
3. `performStableTopologicalSort` keeps its ready-queue sorted with linear
   scan + `splice`, and pops with `shift`
   ([topological-sort.ts:33-52](../packages/pg-delta/src/core/sort/topological-sort.ts))
   — O(V²) exactly in the large-schema case where thousands of independent
   nodes are ready simultaneously.
4. `logicalSort`'s comparator re-runs regexes per comparison
   ([logical-sort.ts:71-73](../packages/pg-delta/src/core/sort/logical-sort.ts)).

**Target**, in order of impact:

1. **Pre-filter depend rows to the change set.** Index the phase's
   created/required stable IDs first, then visit only depend rows whose
   endpoints appear in that index. Sorting cost becomes O(changes ·
   avg-fanout) instead of O(catalog). This is the single biggest sort win and
   makes the common dev-loop case (tiny diff, huge database) effectively
   O(changes).
2. **Build the graph once per phase; patch on injection.** Cycle injection
   adds a handful of changes — extend the adjacency/index structures
   incrementally instead of rebuilding. Re-running `findCycle` after each
   repair is fine (cycles are rare); rebuilding everything is not.
3. **Binary min-heap ready-queue** keyed by original index → O(E log V),
   identical output order (the tie-break rule is unchanged).
4. **Parse stable IDs once** into structs before `logicalSort`'s comparator
   runs (this falls out of typed stable IDs, §4.1).

The phase structure, edge semantics, weak-edge filters, and cycle-breaker
logic are untouched; the existing sort test suite is the oracle.

**Expected multipliers** (estimates, to be validated with a benchmark fixture
at ~10k objects): extraction 2–4×, diff 5–20×, sort 3–10× — compounding,
since they are different pipeline stages.

---

## 4. Simplicity track

### 4.0 Where the volume is

`src/core/objects/` = **256 source files / 31,162 LOC** + **127 test files /
18,505 LOC**, across 21 object-type directories (some hold multiple kinds:
`type/` → enum/composite/range; `foreign-data-wrapper/` → FDW, server,
foreign table, user mapping). Each type follows the same template —
`<type>.model.ts`, `<type>.diff.ts`, and a `changes/` directory with
create/alter/drop/comment/privilege/security-label classes — for **106
concrete change classes** total.

The decisive finding: **everything downstream of diffing is already
generic.** The sort, plan, and apply layers consume only
`creates/drops/requires/invalidates` + `serialize()`. The 106 classes exist
to produce four string arrays and one SQL string each. Per-type *information*
varies; per-type *structure* almost never does. Roughly 65% of the volume is
structural duplication, concentrated in the ~15 cookie-cutter types
(collation 676 LOC, extension 646, language 758, schema 792 … up to
publication 1,116), while table (3,528), procedure (1,608), role (1,815), and
the view family carry genuinely irreducible logic.

The duplication also leaks outward as five hand-maintained per-`objectType`
dispatch sites that must be edited for every new type:

- `getPrivilegeTargetStableId`
  ([catalog.diff.ts:47](../packages/pg-delta/src/core/catalog.diff.ts))
- `getSchema`
  ([change-utils.ts:10](../packages/pg-delta/src/core/change-utils.ts))
- `getPrimaryStableId`
  ([fingerprint.ts:88](../packages/pg-delta/src/core/fingerprint.ts))
- `OBJECT_TYPE_TO_PROPERTY_KEY`
  ([change.types.ts:65](../packages/pg-delta/src/core/change.types.ts), used
  by `integrations/filter/flatten.ts`)
- `getFilePath`
  ([export/file-mapper.ts:59](../packages/pg-delta/src/core/export/file-mapper.ts))

### 4.1 Typed stable IDs (first — it unblocks everything)

Stable IDs are strings built by `stableId.*` helpers but **re-parsed** with
regex/string slicing where structure is needed — e.g.
`stableId.slice("procedure:".length, paren)` and `normalizeDependentId` in
[expand-replace-dependencies.ts:419-425](../packages/pg-delta/src/core/expand-replace-dependencies.ts).
That is fragile (quoting, signature commas) and scatters the format.

**Target**: one parsed value type with a frozen canonical string form.

```ts
// src/core/stable-id.ts (sketch)
export type StableId =
  | { kind: "schema"; schema: string }
  | { kind: "table" | "view" | "materializedView" | "sequence" | "domain"
        | "collation" | "type" | "foreignTable"; schema: string; name: string }
  | { kind: "procedure"; schema: string; name: string; args: string[] }
  | { kind: "column" | "constraint" | "index"; schema: string; table: string; name: string }
  | { kind: "role"; role: string }
  | { kind: "comment" | "acl" | "securityLabel"; target: StableId; /* … */ }
  | { kind: "membership"; role: string; member: string }
  // … defacl, server, userMapping, foreignDataWrapper, …

export function formatStableId(id: StableId): string; // byte-identical to today's strings
export function parseStableId(s: string): StableId;
```

**The wire format is frozen.** Stable-ID strings are persisted in plan
fingerprints and matched against SQL-side string synthesis in `depend.ts`;
`formatStableId` must reproduce today's output byte-for-byte, verified by a
parse/format round-trip test over every existing helper. Graph keys and the
change contract keep using strings; structure is recovered with
`parseStableId` instead of regex.

### 4.2 One generic `Change` family with a typed `ref`

Today every change class carries its model under a per-type property
(`.table`, `.collation`, …), which is what forces the five dispatch switches
and the 21-member union in
[change.types.ts](../packages/pg-delta/src/core/change.types.ts).

**Target**: the base change exposes one uniform reference —

```ts
interface ObjectRef {
  objectType: ObjectType;
  stableId: StableId;
  model: BasePgModel;
}

abstract class Change {
  abstract operation: "create" | "alter" | "drop";
  abstract scope: "object" | "comment" | "privilege" | "security_label" | "membership" | "default_privilege";
  abstract ref: ObjectRef;
  abstract creates: string[];   abstract drops: string[];
  abstract requires: string[];  get invalidates(): string[] { return []; }
  abstract serialize(options?: SerializeOptions): string;
}
```

— plus a small set of generic concrete shapes (`GenericCreate`,
`GenericDrop`, `GenericAlter` with a discriminated `action` payload,
`SetComment`, `GrantPrivilege` / `RevokePrivilege` / `RevokeGrantOption`,
`SetSecurityLabel`) whose behavior is driven by the registry (§4.3). Complex
types keep their bespoke classes (`AlterTableAlterColumnType` et al.) but
extend the same base and expose the same `ref`.

With `ref` in place, all five switches collapse to one-liners
(`change.ref.stableId`, `change.ref.model.schemaName`, a registry lookup for
file paths) and `OBJECT_TYPE_TO_PROPERTY_KEY` is deleted. The filter DSL's
public `<objectType>/<field>` paths are preserved by flattening `ref.model`
under the same keys — guarded by a key-set equality test (§9).

### 4.3 `ObjectTypeSpec` registry + one generic diff engine

```ts
// src/core/registry/spec.ts (sketch)
interface ObjectTypeSpec<M extends BasePgModel> {
  objectType: ObjectType;
  sqlKeyword: string;                  // "COLLATION", "TABLE", …
  hasComment: boolean;
  hasPrivileges: boolean;              // + columnLevelPrivileges for relations
  hasSecurityLabel: boolean;
  extract(pool: Pool): Promise<M[]>;   // existing extractor, referenced not rewritten
  requires(model: M): StableId[];      // schema, owner, types, collations, …
  identitySql(model: M): string;       // "schema.name" / "schema.name(args)"
  serializeCreate(model: M, opts?: SerializeOptions): string;
  alterableFields?: Record<string, (m: M, opts?: SerializeOptions) => string>;
  customDiff?(ctx: DiffContext, main: Record<string, M>, branch: Record<string, M>): Change[];
}
```

One generic engine consumes the spec: set-algebra created/dropped/altered
(via §3.2 hashes), then emits `GenericCreate` (+ owner alter, comments,
grants, security labels), `GenericDrop`, and per-field `GenericAlter` —
falling back to drop+create for non-alterable fields. It reuses the existing
shared helpers (`emitObjectPrivilegeChanges` — already used by 16 of 21
types — and `diffSecurityLabels` — 18 of 21); the registry deletes the
per-type *class wrappers* around them, not the logic. `diffCatalogs`'s 21
hand-sequenced imports become a loop over the registry.

**Scope boundary**: the ~15 cookie-cutter types go fully generic. Table,
procedure, view, materialized-view, role, and subscription keep their
diff/serialize behind `customDiff` and only adopt the generic
comment/privilege/security-label shapes. Quirky-but-simple cases (collation's
`REFRESH VERSION`) are an `alterableFields` entry, not a reason to fork.

**Quantified estimate**: −11–12K source LOC and ~150 fewer files (≈35–40% of
`objects/`), with a comparable test-LOC reduction after per-class test files
collapse into per-spec tests. Adding a future object type drops from ~13
files to ~2 (model + spec).

### 4.4 `depend.ts` decomposition

[depend.ts](../packages/pg-delta/src/core/depend.ts) is 1,895 lines but only
two functions: `extractPrivilegeAndMembershipDepends` (line 43 — a series of
independent `aclexplode`/membership/defacl sub-queries) and `extractDepends`
(line 511 — the core `pg_depend` synthesis query with 30+ CTEs).

**Target**: split the ACL/membership part into ~5 named functions
(`relationAclDepends`, `schemaAclDepends`, `membershipDepends`,
`defaclDepends`, `fdwAclDepends`) run via `Promise.all` — they are already
independent queries. **Keep the core `pg_depend` query whole**: it is one
recursive join over `pg_depend`; splitting it would multiply round-trips and
re-implement the OID→stable-ID mapping N times. Centralize the SQL-side
stable-ID `format(...)` literals into one CTE that mirrors `formatStableId`,
so the wire format lives in exactly two audited places (TS + SQL).

Moving per-type dependency extraction next to each type's extractor was
evaluated and rejected: dependency synthesis is inherently cross-type.

### 4.5 Explicit plan pipeline

`diffCatalogs` currently interleaves raw diffing with an inline
dropped-target ACL filter, then callers wire `expandReplaceDependencies` and
`normalizePostDiffChanges` around it. **Target**: a named stage list with one
contract —

```ts
const STAGES: Array<(changes: Change[], ctx: PlanContext) => Change[]> = [
  rawDiff, filterDroppedObjectAcls, expandReplaceDependencies, normalizePostDiffChanges,
];
```

This is a wiring change only. The CLAUDE.md doctrine that these stages are
distinct *by the information they need* is preserved — the goal is to make
the chokepoints legible and independently testable, not to merge them.

### 4.6 Migration order (each step independently shippable)

Old and new coexist throughout because everything downstream speaks the same
change contract; the registry dispatches per-type to either the spec engine
or the legacy diff function during transition.

1. Typed stable IDs (`stable-id.ts`), helpers reimplemented on top; replace
   the parsers in `expand-replace-dependencies.ts`. Zero wire-format drift,
   proven by round-trip tests.
2. Add `ref` to the base change (temporary adapter derives it from existing
   per-type properties); collapse the five switches; delete
   `OBJECT_TYPE_TO_PROPERTY_KEY`.
3. Registry + generic engine; migrate **collation**, then **extension** as
   proofs. Each migration deletes a `changes/` directory and a `*.diff.ts`.
4. Batch-migrate the remaining cookie-cutter types, one PR per batch.
5. Complex types last: route through the registry via `customDiff`; swap
   their comment/privilege/seclabel wrappers for the generic shapes; bespoke
   alter classes stay.
6. Delete the legacy union and dead base plumbing.

**Hard rule per PR: zero serialized-SQL drift.** The existing per-type diff
tests and the integration roundtrip suite are the oracle; a migration PR that
changes any emitted SQL byte is wrong by definition.

---

## 5. API & packaging track (moderate)

### 5.1 Layered subpath exports

The current root export is a flat bag mixing catalog, plan, execution, and
integration concerns, while the two most reusable functions —
`diffCatalogs` and `sortChanges` — are internal. Embedders (e.g. the
Supabase CLI) that already hold two catalogs must go through the monolithic
`createPlan`.

**Target** `@supabase/pg-delta` exports:

```text
.              createPlan / applyPlan / extractCatalog (facade — unchanged)
./catalog      extractCatalog, serializeCatalog, deserializeCatalog, snapshots
./diff         diffCatalogs(main, branch) -> Change[]
./sort         sortChanges(ctx, changes) -> Change[]
./plan         createPlan, applyPlan, Plan, fingerprints, sql-format
./integrations filter + serialize DSL (vendor-neutral) — supabase stays at
               ./integrations/supabase
./catalog-export  (existing, unchanged)
```

Each layer is independently usable; the facade stays the documented happy
path. The `Plan` + fingerprint contract is good and keeps its shape.

### 5.2 WASM-free core install

`@supabase/pg-topo` is imported in `src/core/` **only** by
`declarative-apply/` and one dev-time test helper — the code boundary is
clean; the manifest is not
([package.json:80-89](../packages/pg-delta/package.json) makes it a hard
dependency, dragging libpg-query WASM into every install).

**Target**: move `@supabase/pg-topo` to an **optional peer dependency**,
loaded via dynamic `import()` inside `declarative-apply` with a clear error
("declarative apply requires @supabase/pg-topo — install it alongside
@supabase/pg-delta") when absent.

`@stricli/core` and `chalk` were evaluated under the same lens and **kept**
as regular dependencies for now: they are a few kB of pure JS — the cost of
splitting a CLI package today outweighs the win. Revisit if/when an embedder
objects or §7 changes the CLI's shape.

### 5.3 Rejected restructurings (recorded so they are not re-litigated)

- **Five-package split** (`pg-delta` / `pg-delta-cli` / `pg-delta-declarative`
  / `pg-delta-supabase` / `pg-graph`): cleanest boundaries, but five
  changeset-coupled packages for one tool is real release overhead, and the
  two concrete pains it solves (WASM weight, layered API) are solved by §5.1
  + §5.2 without it. Deferred until a second embedder demands it.
- **Shared `pg-graph` kernel** for the Kahn/Tarjan code used by both
  packages: the genuinely identical code is ~80 lines; everything around it
  (tie-break semantics, cycle policy) is intentionally different (§2). Not
  worth a package.

### 5.4 Monorepo hygiene

- Move `packages/bun-istanbul-coverage` → `tools/` — it is private test
  infrastructure, not a product, and currently gets swept by every
  `--filter '*'` script.
- Document why the root `.stubs/cpu-features` override exists (testcontainers
  → ssh2 transitive native dep) so it survives cleanup passes.
- Defer any `tests.yml` split until §6 reshapes the test pyramid.

---

## 6. Test & CI velocity track

The integration matrix is 45 jobs (3 PG versions × 15 shards, ~10–14 min
each). Profiling the harness shows the time goes to per-test lifecycle, not
to assertions:

- Every `withDb` test creates **two databases** and two fresh pools
  ([container-manager.ts:148-170](../packages/pg-delta/tests/container-manager.ts)),
  and cleanup opens a **third pool per database** just to probe for
  subscriptions
  ([container-manager.ts:176-199](../packages/pg-delta/tests/container-manager.ts)).
- Supabase-flavored tests replay the multi-MB base-init SQL blob into **both**
  databases per test
  ([tests/utils.ts:76-95](../packages/pg-delta/tests/utils.ts)).
- Every roundtrip test pays 2–3 full catalog extractions (§3.1 makes these
  cheaper, but fewer is better than faster).

**Target**, in order of leverage:

1. **Template databases.** Build the Supabase baseline once per container
   into `supabase_base`, then per-test isolation becomes
   `CREATE DATABASE … TEMPLATE supabase_base` — a file-level copy — instead
   of replaying the SQL blob twice per test.
2. **Fixture-first test pyramid.** `serializeCatalog`/`deserializeCatalog`
   already exist. Capture `(catalogA, catalogB)` JSON fixtures once (from a
   container run, regenerated by script like the existing Supabase baselines),
   and turn the bulk of "this DDL change produces these statements"
   assertions into **Docker-free unit tests** of
   `diffCatalogs` + `sortChanges` + serialization. Keep a deliberately thin
   ring of true roundtrip-fidelity integration tests (extract → diff → apply
   → re-extract → assert convergence) as the safety net. This is the change
   that structurally shrinks the 45-job matrix rather than just speeding it
   up.
3. **Skip the subscription probe** unless the test declared it creates
   subscriptions; reuse the admin pool for cleanup.

Expected: 2–5× integration wall-clock from (1) + (3), and a materially
smaller matrix from (2). The shard count and PG-version list then get
revisited from data, not guessed.

---

## 7. Declarative apply: converge on shadow-DB diff

Today there are two ordering engines: the diff path (catalog-exact,
`pg_depend`-driven) and declarative apply (pg-topo static sort + round-based
retry, `maxRounds = 100` —
[round-apply.ts:252-281](../packages/pg-delta/src/core/declarative-apply/round-apply.ts)).
Round-retry is simple and battle-tested, but worst-case O(n²) statement
executions against the live database, and it is only as good as static
parsing — every defer is a wasted network round-trip caused by an edge the
parser could not see.

**Decision: converge on shadow-DB diff as the canonical declarative path.**

```text
.sql files ──single pass──▶ scratch/shadow DB ──extractCatalog──▶ desired Catalog
                                                       │
live target ──extractCatalog──▶ current Catalog ──diffCatalogs/createPlan──▶ plan
```

- Postgres itself resolves the desired state (no fuzzy `ObjectRef` matching,
  no retry heuristics); the trusted `pg_depend` engine produces the plan; the
  output is byte-identical in style to the diff path. `createPlan` already
  accepts a resolved `Catalog` input, so the plumbing exists.
- **pg-topo narrows to its honest strengths**: dev-time ordering of `.sql`
  files for humans, syntax validation, dependency diagnostics, cycle
  reporting. It stops being a production apply engine.
- **Round-based apply remains as the fallback** for environments that cannot
  reach a scratch database, and is not retired until the shadow-DB path is
  green across the full integration matrix. Near-term improvement to the
  fallback: single-pass execution with a bounded deferred queue instead of
  full-round restarts.

Honest trade-offs, stated once: the shadow path requires a reachable Postgres
(scratch database, throwaway container, or template-created sibling DB); it
adds one extraction + diff of latency; round-apply needs nothing but the
target and has accumulated real-world mileage. That is why this is a
convergence with a fallback, not a replacement.

---

## 8. Phased roadmap

| Phase | Content | Effort | Risk | Depends on |
|---|---|---|---|---|
| 1 | Snapshot-consistent extraction (§3.1); content-hash equality (§3.2); opt-in post-apply verify; heap topo queue | days | low | — |
| 2 | Typed `StableId` + `ref` on `Change` + dispatch-switch removal (§4.1–4.2) | ~1 wk | low | — |
| 3 | `ObjectTypeSpec` registry + cookie-cutter type migration, batched PRs (§4.3) | weeks, incremental | medium (SQL-drift gate) | 2 |
| 4 | Sort single-build + depend pre-filter (§3.3); `depend.ts` split (§4.4); explicit pipeline (§4.5) | ~1 wk | low–medium | — |
| 5 | Subpath API (§5.1); optional pg-topo (§5.2); `tools/` move (§5.4) | days | medium (publish config) | — |
| 6 | Template DBs + fixture-based unit diffs + matrix shrink (§6) | ~1–2 wk | low | — |
| 7 | Shadow-DB declarative path, feature-flagged, parity-gated (§7) | longer | medium | 5 |

Phases 1, 2, 5, and 6 are mutually independent and can start immediately;
phase 3 builds on 2; phase 4 can land any time; phase 7 follows 5 (it wants
the `./diff` + `./catalog` layers). Every phase ships behind the standing
rules: changeset per behavior change, RED→GREEN regression tests, zero
serialized-SQL drift for refactor phases.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Serialized-SQL byte drift** during the registry migration silently changes real migrations | One type per PR; existing per-type diff tests + integration roundtrip suite as the oracle; a PR that changes any emitted byte fails by definition |
| **Stable-ID wire-format drift** breaks persisted plan fingerprints and the SQL-side synthesis in `depend.ts` | Format frozen; `formatStableId` round-trip tests over every helper; the SQL-side format lives in one CTE mirrored against the TS helper |
| **Filter DSL path breakage** — users' filters address `<objectType>/<field>` paths produced by `flatten.ts` | Key-set equality test asserting identical flattened paths before/after for every type |
| **Registry type erosion** (heterogeneous spec list tempts `any`) | `ObjectTypeSpec<BasePgModel>` at the engine boundary; full model typing stays inside each spec module |
| **Optional-dependency UX** (declarative apply with pg-topo absent) | Dynamic import with an explicit actionable error; documented in README + CLI help |
| **Snapshot extraction vs poolers** (`pg_export_snapshot` requires session-level transactions; transaction-mode poolers break it) | Detect and fall back to single-connection serial extraction within one transaction (still consistent, just not parallel) |
| **Shadow-DB parity is real work** — round-apply handles parser-blind cases today | Flag-gated rollout; round-apply retired only after the full integration matrix is green on the shadow path |
| **Estimate risk** on the perf multipliers | Add a benchmark fixture (~10k objects) in phase 1 so every later phase measures rather than asserts |

---

## Appendix: baseline metrics

| Metric | Value (commit `115dde8`) |
|---|---|
| pg-delta source (src/) | ~88K LOC, ~511 files |
| `src/core/objects/` | 256 source files / 31,162 LOC; 127 test files / 18,505 LOC |
| Object-type directories / concrete change classes | 21 / 106 |
| `depend.ts` | 1,895 LOC, 2 functions, 30+ CTEs |
| `sort/` | ~4.6K LOC across 15 files |
| Integration tests | 63 files × 3 PG versions, 15 CI shards (45 jobs) |
| pg-topo source | ~4.4K LOC, 18 modules; 38 statement classes, 28 object kinds, 6 phases |
| Library hard deps | `pg`, `zod`, `@ts-safeql/sql-tag`, `picomatch`, `debug`, `@stricli/core`, `chalk`, `@supabase/pg-topo` (→ libpg-query WASM) |
