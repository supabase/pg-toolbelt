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

## Modeled but coarser than fact-grain (known §3.1 granularity deviations)

These extract correctly and diff correctly, but a sub-entity lives inside a
parent fact's payload rather than as its own fact. Consequence: a change to
one sub-entity diffs as a whole-payload change on the parent, and the
sub-entity cannot be a rename candidate or a `pg_depend` edge target.

- **Composite type attributes** — the `attributes` array is a payload blob on
  the `type` fact (`extract.ts`, composite branch). Attribute-grain renames
  and edges are therefore not detected; a composite type with a changed
  attribute is replaced wholesale.
- **Publication table-filters** — the `tables` array (with per-table column
  lists and `WHERE` expressions) is a payload blob on the `publication`
  fact. Column-list / row-filter changes diff at publication grain, and a
  publication that changes both its table set and its schema set emits two
  idempotent `ALTER PUBLICATION … SET` statements (correct, redundant).

Both are correct-but-coarse and tracked for a future normalization pass
(new `typeAttribute` / `publicationRel` fact kinds). They are deviations
from "granularity is one", not correctness bugs.

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
