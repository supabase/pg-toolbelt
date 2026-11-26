# Ephyra property tests

Property-based tests written with [Ephyra](https://github.com/datadog-labs/ephyra), a Rust
property-testing library. Each crate in this Cargo workspace targets one package: `pg-topo` and
`pg-delta`.

## pg-topo

`pg-topo/src/schema.rs` generates random, valid, acyclic PostgreSQL schemas. These use more than 30
statement kinds, with mixed identifier quoting and case, and each statement records the earlier
statements it needs. A property shuffles the statements, splits them into input strings, and calls
`analyzeAndSort` through a Bun worker (`pg-topo/worker.ts`, which imports
`packages/pg-topo/src` directly). The resulting order is then executed in a real Postgres inside
`BEGIN … ROLLBACK`.

Every generated schema is first checked to run in its generated order. A failure therefore means
pg-topo misordered a valid schema, not that the generator wrote bad SQL.

| Property | File | What it checks |
|---|---|---|
| `generator_is_valid` | `tests/props.rs` | the generator's own order executes (harness sanity) |
| `sorted_output_executes` | `tests/props.rs` | pg-topo's order executes; every statement appears exactly once; the order is deterministic; no `CYCLE_DETECTED` or `PARSE_ERROR` |
| `no_spurious_unresolved` | `tests/props.rs` | no `UNRESOLVED_DEPENDENCY` for an object the input creates |
| `graph_is_order_independent` | `tests/props2.rs` | edges and diagnostic codes do not depend on statement order or splitting |
| `noise_is_inert` | `tests/props2.rs` | comments, unicode and `pg-topo:` look-alikes change neither the graph nor the recovered statement text |
| `files_mode_agrees` | `tests/props2.rs` | `analyzeAndSortFromFiles` on nested directories matches string input; `validateSqlSyntax` accepts every input |
| `injected_cycle_is_contained`, `multi_cycles_are_separated` | `tests/props2.rs` | real FK cycles are reported as exact `cycleGroups` in condensation order, nothing is dropped, and the rest still executes |
| `corrupt_input_is_contained` | `tests/props2.rs` | a syntax error in one input never throws, never loses or alters other inputs' statements, and never invents statement text |
| `external_providers_stand_in` | `tests/props2.rs` | removing a dependency-closed set of statements and declaring their objects as `externalProviders` leaves no UNRESOLVED for them, and the rest of the order runs once they exist |
| `annotation_roundtrip` | `tests/props2.rs` | restating a real dependency as `-- pg-topo:requires` / `depends_on`, using pg-topo's own key, resolves and gives the edge |
| `phase_inversion` | `tests/props2.rs` | random `-- pg-topo:phase` on every statement still executes. Exploratory: it currently fails on edges that the default phase order hides |
| `dump_roundtrip` | `tests/props2.rs` | `pg_dump --schema-only` of a generated schema, shuffled and sorted, restores. Commits databases and roles, so it needs its own cluster |

### Running

You need Rust (stable), Bun with `bun install` done at the repo root, and Docker.

```bash
docker run -d --name pgtopo-ephyra -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5432:5432 postgres:17-alpine
cd ephyra
cargo test -p pg-topo-ephyra --test props -- --nocapture --test-threads 1
cargo test -p pg-topo-ephyra --test props2 -- --nocapture --test-threads 1 --skip dump_roundtrip --skip phase_inversion
```

`dump_roundtrip` needs a separate, disposable cluster because it creates and drops databases and
`role_N` roles:

```bash
docker run -d --name pgtopo-dump -e POSTGRES_PASSWORD=pg -p 127.0.0.1:55452:5432 postgres:17-alpine
PGTOPO_PG="host=127.0.0.1 port=55452 user=postgres password=pg dbname=postgres" \
  cargo test -p pg-topo-ephyra --test props2 dump_roundtrip -- --nocapture
```

| Variable | Default | Meaning |
|---|---|---|
| `PGTOPO_PG` | `host=127.0.0.1 port=5432 user=postgres password=postgres dbname=postgres` | connection used to execute orders (always rolled back) |
| `PGTOPO_STEPS` | `25` | generator steps per case |
| `PGTOPO_N` | per property | case count for `props2` properties |
| `PGTOPO_UNMASK` | none | comma-separated known bugs to generate again, or `all` |
| `PGTOPO_DUMP_PORT`, `PGTOPO_DUMP_CONTAINER` | `55452`, `pgtopo-dump` | cluster and container for `dump_roundtrip` |
| `PGTOPO_WORKER` | `pg-topo/worker.ts` in this checkout | worker path, for test binaries built in another checkout (CI) |
| `PGTOPO_CORPUS` | unset | append every worker request (`{mode, sql}`) to this JSON-lines file, for example to replay under `bun test --coverage` |

Ephyra's own variables also apply: `EPHYRA_SEED`, `EPHYRA_TESTS`, `EPHYRA_FAILURES`, `EPHYRA_REPLAY`
and `EPHYRA_REGRESSIONS`. Failing inputs are stored under `.ephyra/` and replayed first on the next
run.

### Known bugs are masked

The generator steers around pg-topo bugs that are already known, so these properties pass and a new
failure is a new bug. Each mask has a name, and `PGTOPO_UNMASK=<name>` (or `all`) turns that
construct back on:

`sqlbody`, `composite`, `ownedby`, `addcol`, `arraysig`, `plpgsql_decl`, `regclass_case`, `operator`,
`like`, `partkey_expr`, `exclude_expr`, `default_arg`, `rowtype_cast`, `type_cast_hidden`,
`schema_elts`, `index_alter`, `identity_alter`, `ctas_addcol`, `body_unqual`, `rename`, `search_path`,
`unknown_stmt`, `do_block`, `subscription`, `dup_key`, `recursive_view_self`, `ann_sig`, `phase_known`.

When a pg-topo fix lands, delete its mask and the check at its use site. The property then guards
against regressions.

## pg-delta

`pg-delta/` drives pg-delta through a long-lived Bun worker (`pg-delta/worker/worker.ts`, which
imports `packages/pg-delta/src` directly and provisions Postgres with `packages/pg-delta/tests/containers.ts`).
Each property generates two schemas A and B, loads them, and asks pg-delta to get from A to B.

Three generators produce the schemas:

| Generator | File | Covers |
|---|---|---|
| `gen` | `src/gen.rs`, `src/model.rs`, `src/render.rs` | columns of many types (enum, domain, composite, arrays, jsonb, identity, generated), constraints, FKs, indexes, views, materialized views, policies, triggers, sequences, statistics |
| `ext` | `src/ext.rs` | partitioning (list, range, hash, sub-partitions), inheritance, ownership, grants, default privileges, `supabase_realtime`; a `Supabase` flavor uses the API roles |
| `obj` | `src/obj.rs` | function signatures (OUT, SETOF, TABLE, VARIADIC, overloads), procedures, aggregates, range types, ICU collations, extensions, event triggers, rules, exclusion constraints, expression indexes, publications, postgres_fdw objects |

| Property | Test file | What it checks |
|---|---|---|
| migration converges | `props.rs`, `ext_props.rs`, `obj_props.rs` | the A→B plan applies on a clone of A, the clone extracts to B's fact base, and seeded rows survive (pg-delta's own `provePlan`); planning twice gives the same plan |
| export round-trips | `props.rs` | `load(export(db))` has the same fact base, in every layout |
| declarative sync converges | `declarative_props.rs`, `obj_declarative_props.rs` | `buildSchemaExport(B)` re-synced onto B plans nothing; synced onto A (`planSchemaFiles`) it applies and the next sync plans nothing |
| OID independence | `stable_props.rs`, `obj_declarative_props.rs` | the same SQL loaded after unrelated objects came and went gives the same hashes and the same plan |
| real rows survive | `rows_props.rs`, `supabase_rows_props.rs` | migration with one real row in every source table (the proof's own seed only does `DEFAULT VALUES`) |
| renames converge | `rename_props.rs`, `declarative_rename_props.rs` | B with 1–3 of its objects renamed afterwards, planned with `renames: "auto"`; the declarative form also checks no rows go missing without a destructive action |
| Supabase profile | `supabase_props.rs`, `obj_supabase_props.rs` | the same properties as `postgres` on a Supabase image with the base-init fixture replayed |

### Running

You need Rust (stable), Bun with `bun install` done at the repo root, and Docker. The worker starts
its own containers through testcontainers.

```bash
cd ephyra
EPHYRA_TESTS=200 cargo test -p pg-delta-ephyra --test ext_props -- --test-threads 1
PGDELTA_TEST_IMAGE=postgres:14-alpine cargo test -p pg-delta-ephyra --test obj_props -- --test-threads 1
EPHYRA_FLAVOR=supabase PGDELTA_SUPABASE_TEST_IMAGE=supabase/postgres:17.12.0.005 \
  cargo test -p pg-delta-ephyra --test obj_supabase_props -- --test-threads 1
```

| Variable | Default | Meaning |
|---|---|---|
| `PGDELTA_TEST_IMAGE` | `postgres:17-alpine` | stock Postgres image (14–18) |
| `EPHYRA_FLAVOR` | unset | `supabase` boots a Supabase container and runs the Supabase-flavor properties; they skip otherwise |
| `PGDELTA_SUPABASE_TEST_IMAGE` | the image pinned in `containers.ts` | Supabase image for `EPHYRA_FLAVOR=supabase` |
| `PGDELTA_WORKER` | `pg-delta/worker/worker.ts` in this checkout | worker path |
| `EPHYRA_SHRINK_TIMEOUT_MS` | Ephyra default | cap shrinking; each candidate is a full plan + proof, so uncapped shrinking can take most of an hour |

`scripts/cli-repro.ts stock|supabase` reproduces two declarative findings with the `pgdelta` CLI
(`schema export` + `schema apply`).

### Known bugs are recognized, not masked

Unlike the pg-topo crate, these generators still produce inputs that hit known bugs. Each property
labels a failure that matches a known family (the `known_bug` functions in `src/*.rs` and the test
files) and passes it, so a new failure is a new bug. Every family also has a failing regression test
in `tests/*_regressions.rs` (supabase/pg-toolbelt#615–#639). When a pg-delta fix lands, that
regression test starts passing: drop its `known_bug` arm so the property guards against regressions.

Not bugs, and kept out of the generators: operators and casts (pg-delta does not model them on
purpose, see `src/extract/unmodeled.ts`), and the intended refusals to replace an in-use domain,
composite or range type.
