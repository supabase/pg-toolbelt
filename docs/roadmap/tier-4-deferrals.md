# Tier 4 — Deliberate deferrals

- **Status**: ⚪ Intentional, documented, regression-free. **Not oversights.**
- Recorded in [`../../packages/pg-delta-next/COVERAGE.md`](../../packages/pg-delta-next/COVERAGE.md)
  and [`../target-architecture.md`](../architecture/target-architecture.md) §7. Listed here so
  they are not mistaken for gaps — each with *what it'd take* and *the trigger to
  revisit*.

---

## 1. 4b's deferred extractor families

**What.** The extension-member provenance flip (4b) observes member-**root**
families with `memberOfExtension` edges and projects them out by default.
**Deferred:** sub-entity families (columns, constraints, indexes, triggers,
policies, rewrite rules) and rare member-root kinds (FDW, server, foreign table,
event trigger, publication) still use the `notExtensionMember` anti-join at
extract time (`packages/pg-delta-next/src/extract/extract.ts`).

**Why safe.** Sub-entity members ride out with their projected parent; the rare
member-root kinds are vanishingly uncommon as extension members. The *default
projected behaviour is identical either way* — verified regression-free.

**What it'd take.** For each family: drop the anti-join, add an `ext_member_of`
column + `pushMemberEdge`, and extend the **existing parity oracle**
(`tests/extension-member-parity.test.ts`) `FLIPPED_KINDS` set. The oracle already
has teeth (it was RED 154-missing before the first flip).

**Trigger to revisit.** A real need to `extract()` an extension's sub-entity
members with provenance (e.g. a tool inspecting extension-owned indexes), or a
new extension that ships member-root FDWs/event-triggers users want to see.

---

## 2. Not-modeled object kinds

**What.** Languages, large objects, FTS configs/dictionaries/parsers/templates,
operator classes/families, casts, transforms, statistics objects are **not
modeled** as first-class facts. `language` is *reserved* in the codec
(`packages/pg-delta-next/src/core/stable-id.ts`, `SIMPLE_KINDS`) but has **no
extractor**; the rest have no reserved id.

**Why safe.** Built-in languages (`sql`, `plpgsql`, `c`, `internal`) are not user
state; the other kinds are out of v1 scope and extension-provided variants are
filtered at extract. None silently corrupt a diff — they're simply not produced.

**What it'd take.** Per kind: an extractor query + a rule-table entry + corpus
scenarios (the codec already reserves `language`; the others need a kind added
first). CLI-690 (CAST) is the canonical "add it when a real need appears" case —
its tests would gate the addition.

**Trigger to revisit.** A user schema that depends on a user-defined language,
cast, or statistics object surviving a roundtrip.

---

## 3. Parallel snapshot extraction

**What.** Extraction is **serial on one `REPEATABLE READ READ ONLY` connection**
(`packages/pg-delta-next/src/extract/extract.ts`). The pg_dump-style parallel
model — a lead connection calls `pg_export_snapshot()`, N workers
`SET TRANSACTION SNAPSHOT` to it and extract concurrently — is **not**
implemented.

**Why safe.** This is a **performance** optimization, not correctness: the single
snapshot is already consistent. Serial extraction is correct and simple.

**What it'd take.** A lead `REPEATABLE READ` txn exports the snapshot; a worker
pool imports it and runs the per-family queries in parallel; results merge into
one fact base. Must preserve the single-snapshot consistency guarantee — and
refactor the 36 serial extractor blocks (which push into shared accumulators)
into independent, mergeable units.

**Why deferred — with the number (milestone A re-profile).** After the set-based
resolver rewrite ([`tier-3-extract-depends-perf.md`](tier-3-extract-depends-perf.md)),
a cold `extract` is ~453 ms and its single largest cost is **one** query — the
`pg_depend` resolver at ~204 ms (≈45%). A worker pool parallelizes *separate*
queries; it cannot split that one. So the parallel ceiling is
`max(resolver, longest other) + snapshot setup` ≈ ~250 ms — **under 2×** — for a
large, consistency-critical refactor. The residual does not justify it today.

**Trigger to revisit.** A future profile where the **residual** (the many small
queries), not the resolver, dominates extraction wall-time — e.g. a schema shape
where the resolver is cheap but per-family extraction is expensive.

---

## 4. Security-label CI prebuild

**What.** The security-label **end-to-end proof is done** (`9da030d`):
`packages/pg-delta-next/tests/security-label-proof.test.ts` runs against a
purpose-built `dummy_seclabel` image
(`packages/pg-delta-next/tests/dummy-seclabel.Dockerfile`,
`tests/containers.ts::seclabelCluster`). The image **builds on first run** and
`PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1` skips the proof where the Alpine/GitHub
CDNs are unreachable. **The only leftover** is a GHCR **prebuild** so CI gets
seclabel coverage without building inline.

**Why safe.** The proof exists and runs locally; CI just doesn't *currently*
exercise it without an inline build.

**What it'd take.** Mirror the old package's prebuild pattern in
`.github/workflows/tests.yml` (jobs `pg-delta-test-image-hash` →
`pg-delta-build-test-images` → probe-pull in the integration job):
hash the Dockerfile + tag map, probe `ghcr.io/<repo>/...:<major>-<hash>` with
`docker manifest inspect`, build+push if missing, then pull+retag in the test
job. Forked PRs fall back to inline build.

**Trigger to revisit.** Adding pg-delta-next to the CI matrix at cutover —
seclabel coverage should run in CI by then.

---

## 5. PGlite in the trusted path

**What.** Using PGlite (WASM Postgres) as a zero-infra shadow/proof backend —
evaluated and **ruled out of the trusted path today**
([`../target-architecture.md`](../architecture/target-architecture.md) §7; Linear CLI-1389
`supa-shadow`).

**Why safe / deferred.** Extension and version parity rule it out: a PGlite diff
would not be extension/version faithful. The engine's honest cost stays "needs a
reachable Postgres."

**What it'd take.** A new frontend (beside the live-DB and SQL-file doors) that
boots PGlite, plus a parity story for extensions and PG version coverage — a
substantial, separately-scoped effort.

**Trigger to revisit.** PGlite reaches extension/version parity with the
supported server Postgres versions, *or* a use case accepts non-faithful diffs
explicitly (a fast local lint, not a trusted migration).

---

## Why these are not in Tiers 1–3

Each is either (a) regression-free under the current default behaviour (4b
families, not-modeled kinds), (b) a pure performance optimization the
architecture already accommodates (parallel snapshot, the seclabel prebuild), or
(c) explicitly ruled out of the trusted path with a recorded rationale (PGlite).
None blocks the product; all are pick-up-when-triggered.
