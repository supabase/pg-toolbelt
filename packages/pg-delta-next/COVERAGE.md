# Catalog coverage & deliberate exclusions

What the extractor models, and where it deliberately stops. Stage-2 doctrine:
extract everything as facts at fact grain; deliberate gaps are recorded here,
never silently dropped.

## Fully modeled (own fact kind + create/drop/alter rules + corpus proof)

schema, role (+ config), role membership, default privilege, extension,
table (incl. partitioned/partitions, INHERITS, replica identity), column,
default, constraint (table + domain), index, sequence (+ OWNED BY), view,
materialized view, function, procedure, aggregate, trigger, policy, rewrite
rule, event trigger, domain, enum / composite / range type, collation,
publication, subscription, FDW, server, user mapping, foreign table.

Global satellite facts (one rule each, any target kind): comment, ACL
(acldefault-normalized), security label.

## Sub-entity facts (granularity is one, §3.1)

Composite-type attributes and publication members are full facts, not
payload blobs — so they diff at sub-entity grain, are rename candidates,
and can be `pg_depend` edge targets:

- **Composite type attributes** → `typeAttribute` facts (schema, type,
  name; payload type + collation), parented to the `type`. On a fresh type
  they inline into `CREATE TYPE AS (…)` (delta-set); on an existing type
  they are managed incrementally: `ADD` / `DROP` / `RENAME ATTRIBUTE …
  CASCADE` all work even while the type is used by table columns and
  preserve the stored data.
- **Published tables** → `publicationRel` facts (publication, schema,
  table; payload column-list + `WHERE`), parented to the `publication`.
  **Published schemas** → `publicationSchema` facts. On a fresh publication
  they inline into `CREATE PUBLICATION FOR …`; otherwise managed with
  `ALTER PUBLICATION ADD/DROP`. A per-table column-list / `WHERE` change
  replaces that member (`DROP TABLE` + re-`ADD`), with no churn on the rest
  of the publication.

One irreducible PostgreSQL limitation: `ALTER TYPE … ALTER ATTRIBUTE …
TYPE` is rejected while the composite is used by a table column (`CASCADE`
only reaches typed tables, not columns). The `typeAttribute` rule supports
the attribute-type change for unused composites and fails loudly with a
clear remediation message for in-use ones — it does not emit a statement
that would fail at apply.

## Environment-gated (modeled; integration proof needs a non-default image)

- **Security labels** — extraction (`pg_seclabel` / `pg_shseclabel`), the
  `securityLabel` rule, and rendering are implemented; the SQL shape is unit-
  proven (`src/plan/security-label.test.ts`). End-to-end proof requires a
  PostgreSQL image with a label-provider module loaded
  (`shared_preload_libraries=dummy_seclabel`), which the default
  `postgres:*-alpine` test image does not carry. Inert on label-free
  databases (the catalogs are empty), so the corpus is unaffected.

## Not modeled (deliberate)

- **Languages** (`pg_language`) — the `language` StableId kind is reserved in
  the codec but not extracted; user-defined languages are rare and the
  built-ins (`sql`, `plpgsql`, `c`, `internal`) are not user state. Add a
  `language` extractor + rule when a real need appears.
- **Large objects, FTS configs/dictionaries/parsers/templates, operator
  classes/families as first-class facts, casts, transforms, statistics
  objects** — out of v1 scope; none are modeled. Extension-provided variants
  are filtered at extract time (see below).
- **Sequence `last_value`** — runtime state, not desired schema state
  (matches every comparable tool). Never extracted.
- **Extension version** — excluded from the `extension` payload (a managed
  platform pins versions out of band; including it produces phantom diffs).
- **Collation `collversion`** — excluded (host-glibc/ICU dependent).

## Extraction-time filtering (a stage-8 follow-up, documented)

Extension-member objects (functions, types, FDWs, …) are filtered at extract
time via `pg_depend` `deptype='e'` anti-joins (`notExtensionMember`). The
target architecture's end state is to extract them WITH `memberOfExtension`
provenance edges and let the policy layer decide visibility (§3.1/§3.9). The
anti-join is the v1 stand-in; the blast radius (every kind's extractor query)
is the reason it has not yet flipped to edges.
