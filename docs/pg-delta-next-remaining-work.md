# pg-delta-next: what remains to be built / improved

- **Date**: 2026-06-14
- **Branch**: `feat/pg-delta-next`
- **Purpose**: a single, honest inventory of everything still open for
  pg-delta-next, tiered by *what kind of work it is* (engineering feature /
  product decision / productization / deliberate deferral). Built from a full
  review of all 16 `docs/` files cross-checked against the code.

## Baseline — what is already done

So this doc stands alone, the starting point it measures from:

- **Engine code-complete (stages 0–9)** — identity codec + fact base, snapshot
  extraction, generic diff, the rule-table planner (one graph, deterministic
  sort, compaction), the proof loop (state + data-preservation + rewrite
  observation), shadow-DB / snapshot frontends, the policy DSL v2 + Supabase
  package, renames + export + drift, and the public API/CLI surface. See the
  `stage-0*` docs and `../packages/pg-delta-next/README.md`.
- **The hardening plan is fully shipped** — all 8 items plus a surfaced Item-2
  fix. See [pg-delta-next-hardening-plan.md](pg-delta-next-hardening-plan.md).
- **4b (the provenance flip) is done** — extension members are observed with
  `memberOfExtension` edges and projected by default; corpus 418/418 on PG15+17,
  differential clean.
- **Security-label end-to-end proof is done** (`9da030d`) — see Tier 4; only an
  optional CI prebuild remains.

Everything below is *beyond* that baseline. None of it was in the hardening
plan's scope.

---

## Tier 1 — Unimplemented engineering feature: Extension-intent Phase B

**The single biggest open item.** Full plan already written:
[extension-intent-phase-b-plan.md](extension-intent-phase-b-plan.md) (design
context in [extension-intent.md](extension-intent.md)).

- **Phase A (done):** a declarative diff no longer *drops* objects a stateful
  extension created operationally (pg_partman child partitions, pgmq queues,
  pg_cron jobs) — `managedBy` edges + `excludeManaged`, plus 4b's
  `memberOfExtension` projection. **No data loss.**
- **Phase B (not started):** make a from-scratch rebuild *recreate* those
  queues / schedules / partman parents by capturing them as `extensionIntent`
  facts and replaying them through the extension's own API (`pgmq.create`,
  `cron.schedule`, `partman.create_parent`), ordered and proven by the same
  one-graph sort + proof loop — no second pipeline.

**Verified absent in code:** no `extensionIntent` kind in
`src/core/stable-id.ts`; no intent rules in `src/plan/rules.ts`; only the
filter-only `pgPartmanHandler` exists (no pgmq / pg_cron handlers); no replay
actions; no Phase B tests.

**The 4 ready steps** (from the Phase B plan): (1) add `extensionIntent` to the
StableId codec; (2) define `IntentKindRule` + a RULES entry + thread params into
`drop`; (3) implement capture + replay per extension (pgmq → pg_cron →
pg_partman); (4) extend the proof for intent roundtrip + regression.

**Blocker (design decision, not engineering):** *how a user expresses intent vs
runtime state* in `supabase/schema/` — Linear **CLI-1431** (and the per-extension
intent matrix **CLI-1430**). Until that format is decided, Phase B's capture
side has no declarative source to diff against. Effort: large; risk: medium
(net-new modeling, but isolated behind the policy/handler layer).

> The 4 ❌ "needs-design" issues in
> [pg-delta-next-linear-assessment.md](pg-delta-next-linear-assessment.md) all
> collapse into this cluster (CLI-1591 Deliverable B, CLI-1430, CLI-1431).
> CLI-1555 ("don't drop partman partitions") is now **solved** by Phase A — that
> assessment entry is stale.

---

## Tier 2 — Product / cutover decision (not engineering): Stage 10

Full plan: [stage-10-cutover.md](stage-10-cutover.md). **Has not happened.**
pg-delta-next is still a clean-room build *behind* the old `packages/pg-delta`
engine: it has not taken the `@supabase/pg-delta` name, the old engine is not
deprecated, and the migration guide is unwritten.

Gated on a **parity bar** (a conjunction, none individually verified-as-met in
the docs):

- corpus 100% green with an empty `EXPECTED_RED`,
- zero untriaged differential divergences,
- a generative-soak quota at scale (quota TBD),
- extractor ring green on all supported PG versions,
- performance benchmarks ≥ the old engine,
- real-world shakedown on production-shaped images.

Plus product calls: package naming (new major of `@supabase/pg-delta` vs new
name), the deprecation banner timing, and writing the migration guide. Framed
explicitly as **not a unilateral engineering decision.**

---

## Tier 3 — CLI / productization layer (engine ready, consumers not built)

The engine exposes the mechanism; the user-facing CLI/product surface that
consumes it is unbuilt. These are the 🟡 "substrate-ready" issues in the Linear
assessment — mostly thin consumers over existing engine APIs.

| Area | Issues | Engine substrate (exists) | Remaining (unbuilt) |
|---|---|---|---|
| Risk classification 2.0 | CLI-1459–1464 | proof-verified per-action safety report (`dataLoss` / `rewriteRisk` / `lockClass`) | v2 wire format, stable `HazardKind` codes, `--allow-hazards` DSL, GitLab reporter |
| Migration squash / repair | CLI-1597, CLI-1598, CLI-1424 | shadow-diff between two states; segmented executor knows txn boundaries | the `squash` command, `migration repair`, multi-file materialization (and dropping the public-only `pg_dump` limitation) |
| Object filtering flags | CLI-1006, CLI-1169, CLI-1432 | `schema` / predicate vocabulary in the policy DSL (`filterDeltas`) | the CLI `--schema` / regex-exclude flags as thin consumers |
| Service-migration baselines | CLI-1436 | `baseline.ts` subtraction + `scripts/generate-supabase-baseline.ts` | commit the generated snapshot + decide refresh/ownership ops |
| Stripe Sync Engine reset | CLI-1582 | externally-managed schema via policy baseline/filter | `db reset` ↔ integration-container sequencing (CLI orchestration) |
| Typed auth errors | CLI-1607 | secret redaction in serialized DDL | a typed, 4xx-mappable auth/connection error surface |
| extractDepends perf | CLI-1603 | parallel single-snapshot extraction (consistency class fixed) | raw `pg_depend` latency tuning on very large DBs (timeout budget / hints) |

---

## Tier 4 — Deliberate deferrals (documented, regression-free)

Intentional, recorded in `../packages/pg-delta-next/COVERAGE.md` /
[target-architecture.md](target-architecture.md) §7 — *not* oversights. Listed
so they are not mistaken for gaps.

- **4b's deferred extractor families** — sub-entity families (columns,
  constraints, indexes, triggers, policies, rules) and rare member-root kinds
  (fdw, server, foreign table, event trigger, publication) still use the
  `notExtensionMember` anti-join. Safe: their members ride out with the
  projected parent, or are vanishingly rare. Flipping them is a bounded
  follow-up gated by the existing parity oracle.
- **Not-modeled object kinds** — languages, large objects, FTS
  configs/dictionaries/parsers/templates, operator classes/families, casts,
  transforms, statistics objects. Reserved IDs where relevant; add an
  extractor + rule when a real need appears.
- **Parallel snapshot extraction** — capture is serial on one
  `REPEATABLE READ` snapshot connection; parallel `pg_export_snapshot()` workers
  are a measured optimization, not correctness.
- **Security-label CI prebuild** — the end-to-end proof now exists
  (`tests/security-label-proof.test.ts` against a built `dummy_seclabel` image;
  shipped `9da030d`). The image builds on first run and skips via
  `PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1`. A GHCR **prebuild** (so CI gets seclabel
  coverage without building inline) is the only leftover here — small, optional.
- **PGlite in the trusted path** — would make proof serverless, but extension /
  version parity rules it out for now (target-architecture §7).

---

## Recommended order, if the goal is shipping pg-delta-next as the product

1. **Extension-intent Phase B** — the only remaining *engineering feature* with
   a ready plan. Needs the **CLI-1431 declarative-format decision** first (that
   is the real gate, not code).
2. **CLI / productization layer (Tier 3)** — turns the ready engine into the
   user-facing flags/commands real adoption needs. Mostly thin, independently
   shippable consumers; risk classification 2.0 and squash are the meatiest.
3. **Stage 10 cutover (Tier 2)** — a product decision once the parity bar is
   demonstrably met; not an engineering task to "just do."

Tier 4 items are pick-up-anytime polish with no urgency.
