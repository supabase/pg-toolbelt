# Stage 2: Extractor Port

> Part of the [north-star architecture](../architecture/target-architecture.md) (§3.1–3.2).
> Depends on: stage 1. Gate: extractor fixture ring per PG version; pg_dump
> observer; content cross-check against old-engine catalogs.

## Goal

Port the most valuable asset in the old repository — the extractor SQL
corpus — to produce the new fact base: structured identity parts, normalized
payloads, dependency edges, all captured under one consistent snapshot.
This stage is where the old system's accumulated `pg_catalog` knowledge
(per-PG-version quirks, normalization doctrine) transfers; treat the old
`*.model.ts` files as the reference implementation to mine, not code to
import.

## Deliverables

1. **Snapshot-consistent capture.** Lead connection: `BEGIN ISOLATION LEVEL
   REPEATABLE READ READ ONLY` + `pg_export_snapshot()`; N workers `SET
   TRANSACTION SNAPSHOT` and run extractors in parallel. Fallback: if
   snapshot export fails (transaction-mode poolers), degrade to serial
   extraction on the single lead connection — still consistent, just not
   parallel. Detect by attempting, not by guessing.
2. **Per-kind extractors returning structured identity.** Queries return
   identity *parts* as columns (`kind, schema, name, args, parent_*`) plus
   the payload columns — never concatenated ID strings (guardrail 1). The
   library-side codec builds IDs.
3. **The fact decomposition.** This is the key design work of the stage —
   what becomes its own fact. The mapping, mined from the old models:

   | Old model nesting | New facts |
   |---|---|
   | `Table.columns[]` | `column` facts, parent = table |
   | column `default` | `default` fact, parent = column (mirrors `pg_attrdef`, which has its own `pg_depend` rows) |
   | `Table.constraints[]` | `constraint` facts, parent = table |
   | `*.privileges[]` (aclexplode output) | `acl` facts, parent = target, identity includes grantee |
   | `*.comment` | `comment` facts, parent = target |
   | `*.security_labels[]` | `securityLabel` facts, parent = target, identity includes provider |
   | role memberships | `membership` facts |
   | extension ownership (currently an extraction-time *filter*) | `memberOfExtension` **edges** — extract everything, filter nothing (§3.9) |

4. **Dependency edges.** Port `depend.ts`: the core `pg_depend` synthesis
   query keeps its single-query shape but returns structured refs; the
   independent ACL/membership/defacl sub-queries (lines ~43–500) become
   separate parallel extractors. An unresolvable reference becomes a
   **diagnostic**, not a silently-dropped `unknown:` row.
5. **Equality-surface policy per kind.** Which attributes enter the hashed
   payload is per-kind knowledge (§3.1). Port the old `stableSnapshot()`
   overrides and `dataFields` exclusions; the known list to honor:
   names-not-attnums everywhere (`tgattr`, `indkey`, `conkey`/`confkey`,
   `prattrs`), canonical `pg_get_*def()` as the comparison form for
   indexes/triggers/rules, **extension `version` excluded from equality**
   (`extension.diff.ts:53-62` ignores it deliberately today).
6. **The three verification rings** (these are the gate):
   - *Fixture ring*: per PG version, a fixture database built from known
     DDL, with tests asserting specific facts exist with specific payloads.
     Start from the old extraction tests and catalog baselines.
   - *pg_dump observer*: two databases the extractor calls hash-identical
     must produce identical `pg_dump --schema-only` output (modulo a small
     documented normalization of dump text).
   - *Old-engine cross-check*: extract the same database with old and new;
     a mapping table asserts every object the old catalog knows appears as
     facts (this catches dropped coverage during the port).

## How to proceed

1. Order kinds by leverage: schema → role → extension (+ provenance edges)
   → table/column/constraint/default → index → view/matview → procedure →
   the rest. Tables first among the hard ones — they exercise the whole
   decomposition.
2. Per kind: write the fixture-ring test (red), port the SQL from
   `packages/pg-delta/src/core/objects/<kind>/<kind>.model.ts` (keep the
   per-PG-version variants — they encode real knowledge), define the
   payload schema (zod is fine; it's a dev-time validator), wire the
   equality-surface exclusions, green the ring.
3. Then the depend port, then snapshot-consistency (capture wrapper), then
   the pg_dump observer, then the old-engine cross-check.

## What to look for (pitfalls)

- **Connections are the caller's trust boundary.** The lead + N worker
  connections all derive from the caller-supplied pool/URL — same
  credentials, same SSL config; the library never stores or re-derives
  credentials. Workers are read-only (`READ ONLY` transactions); enforce
  that in the capture wrapper so an extractor bug cannot write.
- **Shared objects.** Roles/memberships are cluster-level; the extractor
  must scope what it reports (roles referenced by the database's objects +
  all roles, as the old extractor does) and tag them so frontends can apply
  the isolation rules (§3.2).
- **Definition strings embed names.** `pg_get_indexdef()` output contains
  the table name — that's payload, and it breaks rename hash-matching for
  dependents (§4.1 accepts this; just don't *add* avoidable name embedding).
- **The filter trap.** The old extractors pre-filter (`pg_catalog`,
  `information_schema`, extension-owned objects). The new ones extract
  everything visible and record provenance; *policy* filters (§3.9).
  Exception: `pg_catalog`/`information_schema` system objects stay
  excluded — they are not user state.
- **Physical vs logical, again.** Any new payload field sourced from a
  `*_oid` or attnum-bearing column needs name resolution at extraction.
  This is the #1 historical bug class (see the old CLAUDE.md's attnum
  doctrine); the fixture ring should include the canonical reproduction
  (column dropped and re-added → identical logical state).
- **Don't chase completeness silently.** If a catalog feature is
  deliberately not modeled (storage params on some kind, etc.), record it
  in a `COVERAGE.md` per kind — the pg_dump observer will surface gaps;
  triage them into "model it" or "documented exclusion".

## Gate

- Fixture ring green on PG 15/17/18.
- pg_dump observer green on the stage-0 corpus's fixture databases.
- Old-engine cross-check: 100% of old-catalog objects accounted for
  (mapped or documented exclusion).
- Capture is snapshot-consistent (test: concurrent DDL during extraction
  does not produce dangling edges).

## Open decisions for this stage

- Payload schema per kind (the structured replacement of each old model) —
  decided kind-by-kind inside the stage, recorded in the payload schema
  files themselves.
- How much of `pg_dump` output normalization the observer needs (whitespace,
  comment lines) — keep the normalizer tiny and documented.
