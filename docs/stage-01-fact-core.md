# Stage 1: Identity Codec + Fact-Base Core

> Part of the [north-star architecture](./target-architecture.md) (§3.1).
> Depends on: stage 0 (the package exists). Pure library code — no database,
> no Docker. Gate: property tests for codec round-trip, rollup algebra, hash
> stability.

## Goal

The data layer everything else stands on: typed identity, facts, edges,
hashing, Merkle rollups, and the snapshot format. Get this right and stages
2–9 are consumers; get it wrong and every stage pays. It is also the easiest
stage to test exhaustively — exploit that.

## Deliverables

1. **`StableId`** — discriminated union covering every fact kind. Enumerate
   from the current system's `stableId.*` helpers
   (`packages/pg-delta/src/core/objects/utils.ts`, ~25 helpers) as the
   checklist of kinds: schema, table, view, materializedView, foreignTable,
   sequence, index, trigger, rule, policy, procedure (signature-keyed),
   aggregate, domain, collation, type (enum/composite/range), extension,
   language, eventTrigger, publication, subscription, role, fdw, server,
   userMapping — plus sub-entity kinds: column, constraint, default — plus
   metadata kinds: comment, acl, securityLabel, membership, defaultPrivilege.
2. **The codec** — `encodeId(id): string` / `parseId(s): StableId`:
   - One escaping rule for all kinds (recommend: quote any part containing
     `. : ( ) " ,` with `"`, double inner quotes — i.e. PostgreSQL's own
     identifier-quoting convention, which contributors already know).
   - A version tag in persisted form (`v1:` prefix or a snapshot-level
     field — prefer snapshot-level: tag once, not per ID).
   - **Do not copy the old format.** Today's strings have known quirks
     (ad-hoc acl/defacl encodings, signature commas unescaped). Design
     clean; nothing depends on the old format (architecture doc, decision
     log f).
3. **`Fact`, `DependencyEdge`, `FactBase`** as specified in §3.1. Facts are
   immutable after construction. Edges: `{from: StableId, to: StableId,
   kind: "depends" | "owns" | "memberOfExtension" | ...}` — enumerate edge
   kinds from `depend.ts`'s deptype handling plus the synthesized
   ACL/membership sources.
4. **Canonical payload encoding + digest.**
   - Canonical encoding: recursively sorted object keys; type-tagged
     scalars (so `"1"` ≠ `1`); bigint-safe; arrays preserved as-is when
     order is semantic, sorted when set-valued — the *payload author*
     (stage 2) decides per attribute, the encoder just provides both.
   - Digest: SHA-256 via `node:crypto` (works in Bun/Node/Deno without a
     native dep; ≥128-bit per §3.1). Store full 32 bytes; compare as
     strings. Revisit BLAKE3 only if profiling demands it.
   - **Identity-free**: the encoder must never receive the fact's own name
     or parent name. Enforce structurally — `payload` is a separate object
     from `id`, and a lint-level test greps payload schemas for
     name-shaped fields.
5. **Rollup algebra.** `rollup(fact) = H(payloadHash ‖ sortedChildRollups ‖
   sortedOutgoingEdgeHashes)` with sorting by canonical ID encoding.
   Design now, even if computed lazily: the **structural rollup** variant
   (same fold, IDs excluded) used by stage 9's rename matching — it shares
   the tree walk, so the API should accept the variant as a parameter.
6. **Snapshot format v1.** A single JSON document: `{formatVersion: 1,
   pgVersion, capturedAt, facts: [...], edges: [...]}`. Round-trips
   losslessly: `deserialize(serialize(fb))` is hash-identical.
7. **One shared diagnostic type** used by every later stage:
   `{code, severity, subject?: StableId, message, context}`. Stage 2's
   unresolved-reference diagnostics, stage 7's loader rejections, stage 8's
   dangling-requirement error, and stage 6's apply reports all reuse this
   shape — defining it here is what keeps error output renderable by one
   CLI formatter instead of five ad-hoc shapes.

## How to proceed

1. Types first, then codec with property tests, then hashing, then rollups,
   then snapshot. Each layer's tests written before the layer (repo TDD
   policy applies inside stages too).
2. Property-test the codec hard: round-trip arbitrary identifiers including
   `"`, `.`, `(`, unicode, empty-string schema (forbid it explicitly),
   procedure args containing commas and quoted type names.
3. Commit **golden hash fixtures**: a handful of hand-built fact bases with
   their expected digests checked in. This pins the canonical encoding —
   accidental drift (key-order change, scalar-tagging change) breaks the
   golden test rather than silently invalidating every future snapshot.
4. Rollup properties to assert: child-order independence; a payload change
   propagates to every ancestor rollup and no sibling; an edge add/remove
   changes exactly the owning fact's rollup chain; empty fact base has a
   defined digest.

## What to look for (pitfalls)

- **Procedure identity.** Signature args must be *normalized type names*
  (the old system resolves them at extraction); the codec just carries
  strings — but define ordering and casing expectations here so stage 2 has
  a contract.
- **`acl` / `defaultPrivilege` identity** is composite (target + grantee
  [+ grantor]); model them as structured fields, not packed strings.
- **Hash truncation.** Don't truncate below 128 bits anywhere, including
  "convenience" short forms in logs (log prefixes are fine, comparisons are
  not).
- **Determinism across runtimes.** JSON number formatting and string
  ordering must be locale-independent — sort by code point, never
  `localeCompare`.

## Gate

- Codec round-trip property suite green (including adversarial
  identifiers).
- Rollup algebra property suite green.
- Golden hash fixtures committed and green.
- Snapshot round-trip is hash-identical.
- No payload schema contains identity fields (enforced by test).

## Open decisions for this stage

- Exact canonical-encoding details (scalar tagging syntax) — decide once,
  pin with goldens.
- Interned in-memory key representation (string vs number) — measure later;
  start with strings, hide behind the FactBase API so it can change.
