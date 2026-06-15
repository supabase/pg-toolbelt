# Linear issue assessment against the new engine (`pg-delta-next`)

- **Date**: 2026-06-13
- **Scope**: every issue in the Linear project *pg-delta: database diffing 2.0*
  (134 issues: 2 In Progress, 7 Todo, 36 Backlog, 75 Done, 8 Canceled, 6 Duplicate).
- **"New engine"**: `packages/pg-delta-next` on `feat/pg-delta-next`
  (HEAD `2a91580`), built to `docs/target-architecture.md` and its stage docs.
- **"Old engine"**: `packages/pg-delta` — the current shipped product, and the
  *differential oracle* for the new build (§9). Many issues marked **Done** in
  Linear were closed against the old engine; this report asks the separate
  question of whether the **new** engine resolves them, and most do so *by
  construction* rather than by porting the old fix.

## How to read the verdicts

| Verdict | Meaning |
|---|---|
| ✅ **construction** | The architecture makes the bug impossible or the feature falls out of the design. No per-issue code is needed. |
| ✅ **corpus** | An explicit corpus scenario (proven both directions under the proof loop) covers it. |
| ✅ **policy** | Handled by the Supabase policy data-package (`src/policy/supabase.ts`) — filtering/serialize/baseline, not engine code. |
| 🟡 **substrate-ready** | The engine already provides the mechanism; the remaining work is CLI surface or data-authoring, **not** engine design. |
| ❌ **needs design** | A genuine gap. A solution *within the documented architecture* is sketched (never an old-engine workaround). |
| ⛔ **out of scope** | DML / data-diffing, or object classes explicitly excluded in `COVERAGE.md` / §1. |
| ➖ **not engine** | Docs, packaging, release, connection/transport layer, product rollout, research, or test-authoring subsumed by the corpus + generative harness. |

**The grounding facts.** The new engine already implements, beyond a bare diff:
the per-action **safety report** (`dataLoss` / `rewriteRisk` / `lockClass`,
proof-verified — `src/plan/plan.ts`, `src/proof/prove.ts`), **three-valued
transactionality** + a segmented executor (`src/apply/apply.ts`, §3.8),
**compaction** (`--no-compact`, §3.6), **rename detection** (`src/plan/renames.ts`,
§4.1), a full **policy DSL** with `ownedByExtension`/`owner`/`target`/`edgeTo`
provenance predicates (`src/policy/policy.ts`, §3.9), the **Supabase integration
as a data package** (`src/policy/supabase.ts`), **baseline subtraction**
(`src/policy/baseline.ts` + `scripts/generate-supabase-baseline.ts`), a
**benchmark harness** (`scripts/benchmark.ts`), and the **missing-requirement
guard** that refuses to emit a satellite/action whose target neither exists nor
is produced by the plan (`src/plan/plan.ts:605`). The corpus is ~190 scenarios.

---

## 1. The issues that are NOT solved — with solutions in the new architecture

Only **one cluster** is a genuine, net-new design gap: **stateful-extension
intent** (pg_partman, pg_cron, pgmq…). Everything else is either solved or is
CLI/data work over an existing mechanism (§2–§6).

### CLI-1555 — declarative sync drops `pg_partman` child partitions  ❌ needs design (Deliverable A)
### CLI-1591 — `pg_partman`: stop dropping managed partitions + capture `create_parent` intent  ❌ needs design (Deliverable B)

**Why it is hard, restated for the new model.** A partman child
(`part_test_p20260415`, `part_test_default`) is a real user-schema table that
carries **no** `pg_extension` dependency (so the extract-time `deptype='e'`
filter misses it) and whose `relispartition` flag cannot distinguish it from a
*user-declared* `PARTITION OF` (so a blanket filter would also suppress
intended partition drops — explicitly rejected by the product). The only
authoritative signal is `<partman_schema>.part_config`, which is **not**
`pg_catalog` — so per the core's "pg_catalog + own utilities only" rule it
cannot live in `src/core`.

**Solution within the architecture** (this is exactly what §3.9 + provenance
edges + the policy layer are for — no core change, no parser):

- **Deliverable A (stop the drops).** Add a *provenance source* to the
  **Supabase integration / extract layer** (not core): when `pg_partman` is
  installed, resolve its schema dynamically via `pg_extension`/`pg_namespace`,
  read `part_config` (+ `part_config_sub`), and emit an **edge fact**
  `managedBy(partman)` on every child whose `pg_inherits` parent is registered
  there (including `*_default` and premade children). Then a single Supabase
  **filter rule** — `{ edgeTo: { … partman … } } → exclude` over `add`/`set`/`remove`
  — drops those children from the plan entirely. This is the same shape as the
  existing extension-member handling (`supabase.ts` Old-12) and the user-trigger
  rule (Rule 3): provenance as data, policy decides visibility. Native
  `PARTITION OF` tables carry no such edge, so their intended drops still fire —
  closing the #5491 regression by construction.

- **Deliverable B (rebuild fidelity / `create_parent` intent).** This is the
  genuinely unsolved part and it brushes against the permanent **DML
  out-of-scope** boundary (§1): a from-scratch rebuild needs the
  `create_parent(...)` call (and the intent subset of `part_config`'s ~40
  columns) **replayed**, ordered after the parent table. The architecturally
  honest home is a **frontend/policy "intent replay" channel**, *not* the schema
  fact base: model partman config as a small set of **intent facts** owned by the
  integration, rendered as `create_parent()` / `set_part_config()`-style replay
  actions that the one-graph sort orders after the parent. The blocker is **RFC
  open question #2** (CLI-1431): on the *declarative* path the desired catalog
  won't contain `part_config` rows unless the schema source encodes them — so
  this needs the declarative-source representation decided first. Until then,
  Deliverable A (no data loss) ships; Deliverable B waits on CLI-1430/1431.

### CLI-1385 — Extensions diffing / data diffing  ⛔ partly out of scope / ❌ partly needs design
The schema-diffing half (managed/extension schemas) is **solved by policy**
(§3). The **data-diffing** half — capturing `cron.schedule(...)`,
`pgmq.create(...)`, vault secrets as *intent* — is **permanently out of scope
for the schema contract** (§1: "Out of scope, permanently: data migrations
(DML)"). It can only re-enter as a *separate, explicitly-additive* intent-replay
channel layered beside the engine (same mechanism sketched for partman
Deliverable B), never inside the trusted diff path. This is a product/RFC
decision, not an engine gap.

### CLI-1430 — per-extension intent matrix · CLI-1431 — declarative source format for stateful extension state  ❌ needs design (research)
These two define the *data and the format* that Deliverable B / data-diffing
need. The architecture supplies the **substrate** (policy predicates, provenance
edges, baseline subtraction, an intent-replay channel) but the **content** —
which `part_config`/`cron.job`/`pgmq` columns are intent vs runtime state, and
how a user expresses that intent in `supabase/schema/` — is net-new design.
Verdict stays research/design; everything they feed into already exists.

### CLI-1389 — `supa-shadow`: zero-infra `pg_catalog` shadow via PGlite  🟡 deferred by design
§7 explicitly evaluates PGlite and **rules it out of the trusted path today**
("extension and version parity rule it out"). The new engine's honest cost is
"needs a reachable Postgres." `supa-shadow` is a legitimate *future frontend*
(it would slot in beside the live-DB and SQL-file doors of §3.2), but it is
intentionally not in scope for v1 — its diffs would not be extension/version
faithful. Not a gap; a recorded deferral.

### The "substrate-ready" set (engine done, CLI/data surface remaining)
These need no engine design — only a consumer or a data file:

- **CLI-1459 / 1460 / 1461 / 1462 / 1463 / 1464 — Risk classification 2.0.** The
  engine already emits a **proof-verified** per-action safety report
  (`dataLoss`/`rewriteRisk`/`lockClass`, vs the old `risk.ts`'s 3 hardcoded
  `data_loss` ops). Phases 1–5 are the *productization* of that report: the v2
  wire format, `HazardKind` stable codes, `--allow-hazards` DSL, GitLab reporter.
  The hazard *content* (lossy casts, lock levels, replication, security
  regressions) maps directly onto rule-table per-action metadata; lock classes
  come from the vetted table (`src/plan/locks.ts`).
- **CLI-1436 — service-migration baseline mechanism.** `baseline.ts` +
  `scripts/generate-supabase-baseline.ts` implement fact-base subtraction (§3.9);
  what remains is operational — committing the generated snapshot
  (`src/policy/baselines/` currently holds only `.gitkeep`) and deciding
  generation/refresh/ownership.
- **CLI-1597 / 1598 — rewrite `migration squash` on pg-delta + multi-file output.**
  The shadow frontend + plan provide "diff between two shadow states," and the
  segmented executor already knows the forced transaction boundaries (§3.8); the
  squash command, `migration repair` generation, and multi-file materialization
  are CLI work over those plan segments.
- **CLI-1424 — squash only preserves `public`.** The new engine diffs **all**
  schemas (no public-only limitation); the limitation was a `pg_dump` artifact
  the CLI-1597 rewrite removes.
- **CLI-1169 — regex flag to exclude triggers/indexes.** The real defect
  (objects auto-created by user `ddl_command_end` event triggers reappearing in
  every diff) is addressable with a **policy predicate**; a regex CLI flag is a
  thin consumer over `filterDeltas`. Substrate present.
- **CLI-1006 — schema filtering flag.** The `schema` predicate in the policy DSL
  is the engine-level mechanism; the CLI flag is a consumer.
- **CLI-1603 — make `extractDepends` faster.** The new extraction is parallel +
  single-snapshot (§3.2); that fixes the *consistency* class of failures, and
  the snapshot model removes mid-run aborts, but raw `pg_depend` query latency on
  huge DBs is still a tuning concern (statement-timeout budget, index hints).
- **CLI-1582 — `db reset` fails with the local Stripe Sync Engine.** The
  engine-side lever is the same as managed-schema handling: treat the
  integration-owned (Stripe) schema as an **externally-managed schema** excluded
  via a policy baseline/filter, so pg-delta never emits drops or cross-schema FKs
  against it. The `db reset` ↔ integration-container *sequencing* is CLI
  orchestration, outside the engine.
- **CLI-1607 — typed auth-failure error + credential redaction.** Redaction of
  secrets in serialized DDL is **done** (corpus `sensitive-handling--*`); the
  typed, 4xx-mappable auth error is a connection/error-surface concern (CLI).
- **CLI-1432 — cross-schema trigger patterns.** Already substantively handled:
  `supabase.ts` Rule 3 keeps user triggers on managed-schema tables
  (`auth.users → public.profiles`) keyed on the trigger function's schema; the
  ticket's remaining value is edge-case research.

---

## 2. Solved by construction or corpus (the bulk)

Bugs that **cannot recur** in the new model, and features that are reimplemented
and proof-covered. Cited by mechanism (§ of the architecture) and corpus
scenario where one exists.

| Issue | Status | Verdict | Why solved |
|---|---|---|---|
| CLI-1616 domain CHECK dependents silently skipped | Backlog | ✅ corpus | `domain-operations--check-references-replaced-function`; generic forced-dependent-rebuild (= GitHub #286). |
| CLI-1612 `CREATE TYPE AS RANGE` unsupported | Backlog | ✅ construction+corpus | Range types are first-class facts (`type-ops--range-create`, `--range-used-in-table`); no pg-topo in the trusted path (P1) (= #282). |
| CLI-1557 user objects referencing managed-schema objects get stuck | Backlog | ✅ construction+corpus | Plan-to-target, not round-apply; managed objects supplied by target/baseline. `mixed-objects--cross-schema-reference` (= #269). |
| CLI-1604 `CreateIndex` crash "indexableObject … columns" | Backlog | ✅ construction | No `indexableObject` document-join exists; indexes render from `pg_get_indexdef` facts. The parent-lookup-returns-`undefined` class (§8.7 translation) is removed. Partitioned-table index parents covered (`partitioned-table-operations--range-partition-with-indexes`). |
| CLI-1608 retry OID-race during extraction | Backlog | ✅ construction | Single `REPEATABLE READ` exported snapshot (§3.2) freezes the catalog; `cache lookup failed`/`could not open relation` mid-extract cannot occur, so the retry machinery is unneeded. |
| CLI-1609 "integer out of range" in `extractSequences` | Backlog | ✅ construction | `last_value` is runtime state and is never extracted (`COVERAGE.md`); the int4-cast path doesn't exist. |
| CLI-1567 db diff misses reloption-only changes on views | Backlog | ✅ construction+corpus | View reloptions live in the hashed fact payload → a reloption-only change is a `set` delta → `ALTER VIEW … SET`. `view-operations--options`. |
| CLI-1471 orphan GRANT on aggregate without CREATE | Backlog | ✅ construction | Aggregates are first-class facts (`prokind='a'`, `aggregate-operations--{create,grant,ordered-set-create-grant}`); the missing-requirement guard (`plan.ts:605`) + satellite-folds-into-removed-parent make "GRANT without its object" impossible. *(Recommend a policy/corpus scenario to pin the extension-member-aggregate case.)* |
| CLI-1611 pg-topo ALTER TABLE expr subcommands miss fn deps | Done | ✅ construction | pg-topo is dev-layer only (§4.4); the trusted path takes dependencies from `pg_depend` facts. Moot for the engine. |
| CLI-1596 execution-aware tx batches (#262 enum ADD VALUE 55P04) | Done | ✅ construction+corpus | §3.8 segmented transactionality; `mixed-objects--enum-add-value-with-functions`. |
| CLI-1605 CycleError on Publication + 2× DropTable + DropConstraint | Done | ✅ construction+corpus | No cycle breakers; decomposition makes the cycle non-existent (§3.5–3.6). `dependencies-cycles--drop-publication-{fk-chain-tables,listed-column}`. |
| CLI-1601 auth dependencies in shadow-db migrations | Done | ✅ construction | Shadow frontend + cross-schema edges from `pg_depend`; same path as CLI-1557. |
| CLI-1467 leaks FDW / user-mapping passwords | Done | ✅ corpus | `sensitive-handling--{server-with-sensitive-options,user-mapping-options}`, `fdw-option-secret-redaction--multi-layer-fdw-schema`. |
| CLI-892 print placeholder for sensitive info | Done | ✅ corpus | `sensitive-handling--*`. |
| CLI-1386 Support Security Labels | Done | ✅ construction | `securityLabel` global fact + rule; unit-proven, e2e env-gated on a label-provider image (`COVERAGE.md`). |
| CLI-846 Fingerprint database state | Done | ✅ construction | Rollup-hash fingerprints are the same machinery as equality (§3.7). |
| CLI-747 Be safe by default | Done | ✅ construction | Data-preservation proof + per-action safety report (§3.7) — stronger than the old posture. |
| CLI-845 Plan mode | Done | ✅ construction | Plan artifact + `cli/commands/plan.ts` (§3.7). |
| CLI-882 break sequence cycle (create table + add default) | Done | ✅ corpus | `dependencies-cycles--sequence-owned-by-col-with-default`, `sequence-operations--owned-by-column-with-table-default`. |
| CLI-843 FDW / foreign table / server / user mapping | Done | ✅ corpus | `foreign-data-wrapper-operations--*`. |
| CLI-841 Subscription · CLI-840 Publication · CLI-842 Event trigger · CLI-839 Rule · CLI-838 Aggregate | Done | ✅ corpus | `subscription-operations--*`, `publication-operations--*`, `event-trigger-operations--*`, `rule-operations--*`, `aggregate-operations--*`. |
| CLI-674 grant/revoke on all objects | Done | ✅ construction | One global ACL fact rule (§3.4); `privilege-operations--*`. |
| CLI-672 Support for comments | Done | ✅ construction | One global comment fact rule; `comments`, `*-comment` scenarios. |
| CLI-720 diff grants against default privileges | Done | ✅ construction+corpus | `acldefault`-normalized ACL facts; `default-privileges-{edge-case,ordering}--*`. |
| CLI-662 PARTITION BY for table | Done | ✅ corpus | `partitioned-table-operations--*`, `table-ops--{attach,detach}-partition`. |
| CLI-754 column type change with default | Dup | ✅ corpus | `alter-table--column-type-enum-default`, `column-type-change`. |
| CLI-728 extensions versioning | Dup | ✅ construction | Extension `version` excluded from the hashed payload (§3.1) — no phantom diffs. |
| CLI-794 add missing database objects · CLI-451 exhaustive introspection · CLI-473 list queries · CLI-602 create/alter/drop all objects · CLI-603 dependency-solving engine · CLI-656 `pg_get_*def` for CREATE · CLI-654 fix PG15 e2e | Done | ✅ construction | These *are* the new engine: extractor port (stage 2), rule table (stage 5), one-graph sort (§3.6), canonical `pg_get_*def` payloads, PG15 in the corpus. |
| CLI-663 replace `stableId` with `dependencies()` + DAG · CLI-669 `quote_ident` everywhere incl. depend | Done | ✅ construction | Realized cleanly: a DAG over fact edges (§3.6); a single identity codec with no SQL-side string building (§3.1, guardrail 1). |
| CLI-665 `CREATE OR REPLACE` instead of DROP;CREATE | Done | 🟡/✅ | Attribute rules pick in-place vs replace; `function-ops--replacement`, `view-operations--replace-with-new-dep`. |
| CLI-675 view owner · CLI-712 Hasura event-trigger fn introspection | Done | ✅ corpus | `view-operations--owner-change`; `event-trigger-operations--create-with-function`. |
| CLI-750 Postgres 18 support | Done | ✅ construction | §9 targets 15/17/18 via the stage-2 fixture ring. *(Verify PG18 lane in CI.)* |
| CLI-343 PostgREST command not in `db diff` | Done | 🟡 | Re-covered by first-class `eventTrigger` + `comment` facts; if the object is platform-managed it is a policy concern. *(Verify against the original repro.)* |

---

## 3. Solved by the policy layer (Supabase data-package)

`src/policy/supabase.ts` ports every filterable behavior of the old integration
into DSL v2 (provenance/identity predicates, first-match-wins). These are
**solved without engine code**:

| Issue | Verdict | Policy mechanism |
|---|---|---|
| CLI-1469 suppress GRANT/REVOKE on FDW (superuser-only) | ✅ policy | Rule 9: `{ kind:"acl", target:{kind:"fdw"} } → exclude`. |
| CLI-1470 suppress CREATE FDW for platform/Wasm wrappers | ✅ policy | Extension-member FDWs filtered at extract (`deptype='e'`); `owner`/`ownedByExtension` predicates cover stragglers (Old-12). |
| CLI-1468 non-portable SQL on FDW projects (umbrella) | ✅ policy | Composite of 1469 + 1470 + the owner gate. |
| CLI-1437 filter foundation (InternalSchemas/excludedSchemas/reservedRoles) | ✅ policy | `SUPABASE_SYSTEM_SCHEMAS`/`_ROLES` + the DSL + `baseline.ts` are the §3.9 realization of this. |
| CLI-745 programmatic filtering hook | ✅ policy | `filterDeltas` + the `Policy` DSL (§3.9). |
| CLI-1594 realtime publication changes not captured | ✅ policy | Publications are facts (`publication-operations--*`); the platform `supabase_realtime` publication is baseline/owner-filtered, user changes diff. (Canceled in Linear; consistent.) |
| CLI-1435 pg_cron ownership normalization · CLI-1434 vault presence-only · CLI-1433 pg_net webhook templating | research | Substrate present (schema filtering, provenance, baseline); the per-extension *content* is data/design (feeds §1 cluster). pg_net URL templating is environment-substitution and brushes the DML boundary. |

---

## 4. Out of scope by design

| Issue | Verdict | Basis |
|---|---|---|
| CLI-697 data-migration plugins/hooks for custom SQL | ⛔ | DML; §1 "out of scope, permanently." |
| CLI-341 cron jobs not listed in `supabase diff` | ⛔ | `cron.job` rows are extension data → data-diffing / intent (CLI-1385). |
| CLI-844 Operator / operator class / operator family | ⛔ | Not modeled in v1 (`COVERAGE.md`); matches the Linear cancel. |
| CLI-475 Introspect Language | ➖/⛔ | `language` kind reserved but deliberately not extracted (`COVERAGE.md`); built-ins aren't user state. Add an extractor+rule when a real need appears. |

---

## 5. Not an engine question (CLI / transport / release / process)

These are real work but live outside `pg-delta-next`'s engine, or are made moot
by the clean-room design.

| Issue | Verdict | Note |
|---|---|---|
| CLI-1586 make pg-delta the CLI default · CLI-1588 [BC] flip global default · CLI-1587 enable in config.toml | ➖ | Rollout of the **old** engine; product decision. The new engine is a separate clean-room library cut over at the §10 parity bar. |
| CLI-1446 non-interactive declarative-sync flag · CLI-935 cli flag for pg-delta diff · CLI-698 CLI usability | ➖ | CLI surface. |
| CLI-1606 connect-timeout 7S0 · CLI-1610 unreachable-branch state · CLI-942 self-signed SSL · CLI-941 change login role after connect | ➖ | Connection/transport layer + product error surfaces. |
| CLI-865 packaging · CLI-934 publish to npm | ➖ | Packaging falls out of §4.5; new engine ships as a new package at cutover. |
| CLI-863 alpha blog post · CLI-864 docs website · CLI-1618 CLI workflow docs | ➖ | Docs/marketing. |
| CLI-711 harmonize `serialize()` · CLI-719 refactor change classes · CLI-476 partial-match assertions · CLI-658 reword ordering constraints · CLI-655 transitive-deps expansion · CLI-928 IF EXISTS for cluster objects | ➖ moot | All target old-engine internals (106 change classes, hand constraints, cycle handling) that the new design deletes outright (§6). The one-graph sort handles transitive deps and existence natively; new tests never assert SQL bytes (guardrail 6). |
| CLI-664 run CLI migration issues vs pg-diff | ➖ | This very exercise (process). |
| CLI-657 optimize introspection queries · CLI-695 perf/error-logging tests · CLI-770 staging integration tests · CLI-714 roundtrip validation · CLI-716 infra integration · CLI-713 dogfood/replace migra | ➖/🟡 | Benchmark harness (`scripts/benchmark.ts`), the generative soak, `diagnostic.ts`, and the proof loop cover the engine-facing parts; the rest is infra/process. |
| **Test-authoring tickets** — CLI-696, 694, 693, 692, 691, 690, 689, 688, 687, 686, 685, 684, 683, 682, 681, 680, 679, 678, 668, 677, 673, 715, 436, 770 | ✅ subsumed | The "cover X with tests" tickets are absorbed by the **seed corpus + generative engine + differential oracle** (§4.3). The listed behaviors (identity/generated columns, collations, inheritance, enums, RULES, casts, privileges, dependency ordering, mixed objects…) already have corpus scenarios or are generated; "tests as data" replaces the hand-written per-type matrix. CLI-690 (CAST) is the one whose object kind is **not** modeled (`COVERAGE.md`) — its tests would gate adding casts later. |

---

## 6. Summary

- **One real design gap**, and it is the one the maintainers already scoped as
  hard: **stateful-extension intent** (CLI-1555 / 1591 / 1385 / 1430 / 1431).
  *Deliverable A* (stop dropping partman children — no data loss) is fully
  expressible today as a Supabase-integration provenance source + one filter
  rule. *Deliverable B* (replay `create_parent`/intent on rebuild) and the
  broader data-diffing ask are **deliberately outside the schema contract** (§1)
  and need a separate, additive intent-replay channel plus a declarative-source
  format decision — net-new design, not an engine fix.
- **The field-bug backlog is overwhelmingly solved *by construction*.** The
  recurring old-engine failure shapes — cycle errors, orphan satellites,
  document-assembly crashes (`CreateIndex`), missed reloption diffs, extraction
  OID-races and `last_value` overflows, leaked secrets, over-/under-recreation
  around replacements — are eliminated by the fact model, the one-graph sort, the
  single-snapshot extractor, the missing-requirement guard, and the proof loop,
  not by per-issue patches.
- **The Supabase-specific cluster is policy, and the policy package already
  exists** (managed-schema/role filtering, user triggers on managed tables, FDW
  ACL suppression, extension-member filtering, baseline subtraction).
- **Risk 2.0, squash, schema-filter flags, regex excludes** are *substrate-ready*:
  the engine emits a proof-verified safety report and segmented plans; what
  remains is CLI/wire-format/data authoring.
- **Recommended follow-ups to pin the few "construction" claims:** add corpus
  scenarios for (a) an extension-member aggregate whose GRANT must be suppressed
  with it (CLI-1471), and (b) the partman provenance-filter once Deliverable A
  lands; and **commit a generated Supabase baseline snapshot** (CLI-1436) so
  baseline subtraction is exercised in CI rather than only generatable.
```
