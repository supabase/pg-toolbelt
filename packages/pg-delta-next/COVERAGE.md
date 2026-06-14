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

## Extension members: observed, projected by default (4b)

Extension-owned objects are **observed** at extraction as ordinary facts
carrying a `memberOfExtension` edge to their extension — "provenance is data, an
edge fact, not an extraction-time filter" (§3.1) — and then **projected out of
the managed universe by default** in `plan()`/`prove()`
(`excludeExtensionMembers`, the counterpart of `excludeManaged`). So policy-free
behaviour is unchanged (members never diff), while raw `extract()` can see them
with full ownership provenance.

Flipped (member-ROOT families, each observed + tagged, verified by the
`extension-member-parity` pg_depend oracle): schemas, tables, sequences,
views/materialized views, routines (functions + procedures), aggregates,
domains, enum/composite/range types, collations.

A reference INTO a member (a user table column of an extension type, a default
calling an extension function) resolves to the **extension**, not the member
fact (the resolver's collapse branches): the member is projected out, so a
member-targeted edge would be pruned with it and the dependent would lose its
ordering on the extension. The collapsed edge points at the extension (which
survives), so ordering holds — pinned by `extension-member-ordering`.

**Still filtered (documented, regression-free):** sub-entity families (columns,
constraints, indexes, triggers, policies, rewrite rules) and rare member-root
kinds (foreign data wrappers, foreign servers, foreign tables, event triggers,
publications) keep their `notExtensionMember` anti-joins. Their members ride out
with the projected parent (sub-entities) or are vanishingly rare (the rest), so
the default projected behaviour is identical either way; they were left to keep
the migration bounded and fully parity-gated.

## Field-issue corpus (old-engine bugs, verified gone or fixed)

Open `supabase/pg-toolbelt` issues converted to corpus scenarios. Most were
old-engine flaws the new architecture does not reproduce; one (#263) exposed
a real gap that is now fixed.

| Issue | Scenario(s) | Outcome in the new engine |
|---|---|---|
| #286 | `domain-operations--check-references-replaced-function` | green — generic forced-dependent-rebuild drops/recreates the domain CHECK around the function replace (old engine silently skipped it) |
| #280 | `function-ops--signature-change-referenced-by-{default,check}` | green — table is never dropped (data-preservation proof on seeded rows); minimal-by-construction |
| #263 | `alter-column-type--blocked-by-{policy,view}`, `function-ops--signature-change-referenced-by-policy` | **fixed** — `ALTER COLUMN … TYPE` now force-rebuilds dependent views/rules/policies (kind-selective `rebuildsDependents`); DROP FUNCTION ref'd by a policy already worked |
| #269 | `mixed-objects--cross-schema-reference` | green — plan applies to a target that has the unchanged managed-schema object; no round-apply "stuck statement" |
| #282 | `type-ops--range-used-in-table` + loader shuffle test | green — `CREATE TYPE AS RANGE` is a first-class fact with a column→type edge; a pg-topo classification bug that does not exist in the new engine |
| #219 | `function-ops--enum-arg-privilege` | green — enum-arg function signatures render stably in GRANT/REVOKE (no temp-schema artifacts) |
| #218 | `constraint-ops--deferrable-unique` | green — `DEFERRABLE INITIALLY DEFERRED` roundtrips via `pg_get_constraintdef` |

Not converted (old-engine architectural chores the new design resolves
differently, no scenario): #250 perf benchmarking (the new engine ships
`scripts/benchmark.ts` + a CI benchmark job + the generative soak), #244
`change.phase` (replaced by per-action three-valued `transactionality` +
the segmented executor), #115 shared topological-sort abstraction (the new
engine has one mixed graph and no pg-topo coupling in the trusted path, P1).
