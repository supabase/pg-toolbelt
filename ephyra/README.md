# Ephyra property tests

Property-based tests written with [Ephyra](https://github.com/datadog-labs/ephyra), a Rust
property-testing library. Each crate in this Cargo workspace targets one package. Today there is
`pg-topo`.

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
| `PGTOPO_CORPUS` | unset | append every analyzed input to this JSON-lines file, for example to replay under `bun test --coverage` |

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
`unknown_stmt`, `dup_key`, `recursive_view_self`, `ann_sig`, `phase_known`.

When a pg-topo fix lands, delete its mask and the check at its use site. The property then guards
against regressions.
