# PLAN: Supabase active extension triage for pg-delta

## Goal

Decide, extension by extension, whether pg-delta needs dedicated work for the set of extensions that appear most often on active Supabase projects.

This document is a planning artifact only. It does **not** propose implementation details or code changes yet.

## Current pg-delta baseline

Today pg-delta already has useful generic extension support:

- extract installed extensions from `pg_extension`
- diff extension create / drop / comment / schema move
- order extension creation before dependent objects
- special-case some Supabase behavior in the Supabase integration

Known extension gaps from the current codebase:

- no extension version upgrade planning yet
- no support for extension member add/drop semantics
- no diffing of extension config tables (`extconfig` / `extcondition`)
- Supabase integration still lacks a canonical `emptyCatalog`
- Supabase integration currently filters out several service-managed schemas (`auth`, `storage`, `cron`, `graphql`, `net`, `pgmq`, `pgsodium`, `vault`, ...)

## Usage-weighted prioritization

The extension counts matter, but they should influence priority together with **migration relevance**:

- some of the most-installed extensions are effectively **baseline/install-state only** (`plpgsql`, `uuid-ossp`, `pgcrypto`, `pg_stat_statements`, `pgjwt`)
- some are highly installed **and** likely to need dedicated pg-delta behavior (`pg_graphql`, `pg_cron`, `pg_net`, `vector`, `pgmq`, `pg_trgm`, `postgis`)
- some are less common overall, but still strategically important because they represent the shape of “extension-managed state” (`pg_partman`, `wrappers`, `postgres_fdw`, `supabase_vault`)

So the right weighting is not “top count always first”, but:

1. **top usage + user-facing managed state** first
2. **top usage + likely regressions in existing generic diffing** second
3. **lower-usage but architecture-defining extensions** third
4. **long-tail install-state extensions** last

### Usage-informed focus tiers

#### Tier 1: highest-value near-term targets

These either sit in the top usage cohort or are close enough to it, and they exercise the extension-specific behavior pg-delta is currently weakest at:

- `pg_graphql`
- `pg_cron`
- `pg_net`
- `vector`
- `pgmq`
- `pg_trgm`
- `postgis`
- `supabase_vault`

#### Tier 2: important coverage / architecture-follow-up

- `wrappers`
- `postgres_fdw`
- `pgsodium`
- `btree_gist`
- `btree_gin`
- `pgroonga`
- `rum`
- `bloom`
- `file_fdw`
- `pg_partman`

#### Tier 3: baseline / install-state only

These are common, but mostly strengthen the case for baseline correctness rather than bespoke diffing:

- `plpgsql`
- `uuid-ossp`
- `pgcrypto`
- `pg_stat_statements`
- `pgjwt`
- `http`
- `unaccent`
- `citext`
- `hstore`
- `ltree`

## Decision buckets

- **No immediate work**: generic extension support is probably enough
- **Coverage only**: generic support is likely enough, but we should add focused regression tests
- **Extension-specific handling**: likely needs Supabase filter / serialize / baseline / ordering work
- **Service modeling**: user-facing state lives in service tables or service schemas, so we should model that state explicitly rather than diff raw extension internals
- **Research / high risk**: likely complex or product-specific enough that we should investigate before committing to support

## Per-extension triage

| Extension | Bucket | pg-delta assessment |
| --- | --- | --- |
| `plpgsql` | No immediate work | Baseline language extension; mainly needs correct baseline handling. |
| `uuid-ossp` | No immediate work | Function-only extension; generic create/drop support should be enough. |
| `pgcrypto` | No immediate work | Function/type extension; no obvious special migration logic needed. |
| `pg_stat_statements` | No immediate work | Stats extension; install state matters more than internal objects. |
| `pg_graphql` | Extension-specific handling | Lives in filtered `graphql` / `graphql_public` schemas; needs Supabase baseline decisions, not raw object diffing. |
| `supabase_vault` | Service modeling | `vault` schema is filtered and security-sensitive; avoid diffing raw secret rows, consider metadata-level modeling only. |
| `pg_cron` | Service modeling | User-facing cron jobs live in `cron` tables; generic extension diff is not enough for a full UX. |
| `pg_net` | Extension-specific handling | Already partly special-cased; keep dedicated Supabase coverage for enable/disable behavior. |
| `pgjwt` | No immediate work | Mostly functions; generic extension handling should be enough. |
| `vector` | Coverage only | Already important and widely used; keep focused tests for type/opclass/index roundtrips. |
| `pgsodium` | Research / high risk | Uses filtered schemas and system roles; security-sensitive and not a good first target for raw diffing. |
| `pg_trgm` | Coverage only | Generic extension support is likely fine, but index/operator-class coverage is important. |
| `pgmq` | Service modeling | Install is special-cased already; queue definitions and runtime state need explicit modeling if we want full support. |
| `postgis` | Coverage only | Core extension install is easy, but geometry/geography column and index roundtrips deserve targeted coverage. |
| `hypopg` | No immediate work | Hypothetical-index helper; install state is the main diffable concern. |
| `index_advisor` | No immediate work | Advisory extension; likely no extra pg-delta behavior needed beyond install state. |
| `http` | No immediate work | Function-only extension; generic support should suffice. |
| `unaccent` | No immediate work | Text search helper; generic support should suffice. |
| `wrappers` | Coverage only | Core extension plus FDW/server/user-mapping objects should already diff; validate the end-to-end story. |
| `moddatetime` | No immediate work | Trigger-function extension; user triggers are already diffed separately. |
| `btree_gist` | Coverage only | Operator-class/index dependency coverage is the main need. |
| `citext` | No immediate work | Type extension; normal table/column diffing should cover usage. |
| `fuzzystrmatch` | No immediate work | Function-only extension; generic support should suffice. |
| `cube` | No immediate work | Type/function extension; normal column diffing should cover usage. |
| `earthdistance` | No immediate work | Function/type extension; no obvious custom handling needed. |
| `btree_gin` | Coverage only | Operator-class/index dependency coverage is the main need. |
| `pg_jsonschema` | No immediate work | Function/operator extension; generic support should suffice. |
| `postgres_fdw` | Coverage only | pg-delta already models FDW/server/user-mapping/foreign-table objects; validate dependency ordering. |
| `hstore` | No immediate work | Type extension; normal table/column diffing should cover usage. |
| `pgaudit` | No immediate work | Install state matters; policy/log behavior is outside schema diffing. |
| `pgtap` | No immediate work | Test helper extension; generic install/remove handling is enough. |
| `dblink` | No immediate work | Function-based extension; generic support should suffice. |
| `ltree` | No immediate work | Type/operator extension; normal column/index diffing should cover usage. |
| `plpgsql_check` | No immediate work | Validation extension; install state is the main concern. |
| `postgis_topology` | Research / high risk | Adds dedicated schemas/tables and extension-managed metadata; likely more than generic extension diffing. |
| `pgroonga` | Coverage only | Search index/operator-class behavior likely needs targeted index coverage. |
| `pg_prewarm` | No immediate work | Operational helper extension; install state is enough. |
| `tablefunc` | No immediate work | Function extension; generic support should suffice. |
| `pg_hashids` | No immediate work | Function extension; generic support should suffice. |
| `pg_stat_monitor` | No immediate work | Stats extension; install state is the main concern. |
| `pg_tle` | Research / high risk | Trusted-language-extension packaging introduces extension-on-extension concerns not modeled today. |
| `plv8` | Research / high risk | Availability/version concerns matter more than schema diffing; low priority for dedicated work. |
| `timescaledb` | Research / high risk | Hypertables, policies, compression, and background jobs suggest first-class modeling, not plain extension diffing. |
| `postgis_tiger_geocoder` | Research / high risk | Fixed schemas and data-heavy extension-managed objects make this a poor generic target. |
| `insert_username` | No immediate work | Trigger-function extension; user triggers are already diffed separately. |
| `supabase-dbdev` | Research / high risk | Package-manager extension; may need package provenance/version strategy, not just create/drop. |
| `pg_repack` | No immediate work | Operational extension; install state is the main concern. |
| `address_standardizer` | Research / high risk | Closely tied to PostGIS geocoder datasets and extension-managed schemas. |
| `pgrouting` | Research / high risk | Builds on PostGIS and may need dedicated functional validation rather than core diff work. |
| `postgis_raster` | Research / high risk | PostGIS family add-on; likely test coverage first, not immediate schema diff work. |
| `intarray` | No immediate work | Type/operator extension; generic support should suffice. |
| `autoinc` | No immediate work | Legacy helper extension; generic support should suffice. |
| `postgis_sfcgal` | Research / high risk | PostGIS add-on with external dependency concerns; low priority for pg-delta-specific work. |
| `pg_partman` | Service modeling | Partition-management config lives in extension-owned tables; full UX needs config modeling, not just install state. |
| `pgstattuple` | No immediate work | Operational helper extension; install state is enough. |
| `rum` | Coverage only | Index/operator-class extension; dependency and serialization coverage is the main need. |
| `address_standardizer_data_us` | Research / high risk | Dataset extension; extension-managed data and schemas need special treatment if supported at all. |
| `pgrowlocks` | No immediate work | Operational helper extension; install state is enough. |
| `dict_int` | No immediate work | Text search helper; generic support should suffice. |
| `tcn` | No immediate work | Trigger helper extension; generic support should suffice. |
| `dict_xsyn` | No immediate work | Text search helper; generic support should suffice. |
| `pgroonga_database` | Coverage only | Companion extension for PGroonga; validate install ordering and search-index coverage. |
| `tsm_system_rows` | No immediate work | Sampling helper extension; generic support should suffice. |
| `sslinfo` | No immediate work | Function extension; generic support should suffice. |
| `isn` | No immediate work | Type/function extension; generic support should suffice. |
| `pg_walinspect` | No immediate work | Operational extension; install state is enough. |
| `bloom` | Coverage only | Index access-method extension; targeted index coverage is the main need. |
| `tsm_system_time` | No immediate work | Sampling helper extension; generic support should suffice. |
| `orioledb` | Research / high risk | Table/index storage behavior likely exceeds current pg-delta abstraction level. |
| `seg` | No immediate work | Type extension; generic support should suffice. |
| `refint` | No immediate work | Legacy helper extension; generic support should suffice. |
| `pg_buffercache` | No immediate work | Operational extension; install state is enough. |
| `pointsource-supabase_rbac` | Research / high risk | Third-party Supabase-specific extension; likely needs quoted-name coverage and product-level semantics review. |
| `olirice-index_advisor` | Research / high risk | Third-party package variant; probably package-management rather than pg-delta core work. |
| `basejump-basejump_core` | Research / high risk | Product-specific SQL extension; likely needs quoted-name coverage and manual review first. |
| `kiwicopple-pg_idkit` | Research / high risk | Product-specific SQL extension; likely generic create/drop only until proven otherwise. |
| `plls` | Research / high risk | Availability/version concerns matter more than schema diffing; low priority for dedicated work. |
| `supautils` | Research / high risk | Supabase-specific helper extension; likely needs explicit product review before support promises. |
| `plcoffee` | Research / high risk | Availability/version concerns matter more than schema diffing; low priority for dedicated work. |
| `basejump-supabase_test_helpers` | Research / high risk | Test-helper extension; likely not worth special pg-delta work beyond install/remove. |
| `pointsource@supabase_rbac` | Research / high risk | Unusual quoted extension name; confirm extraction/serialization works before anything else. |
| `lo` | No immediate work | Large-object helper extension; install state is enough. |
| `adminpack` | No immediate work | Admin helper extension; install state is enough. |
| `file_fdw` | Coverage only | FDW objects are already modeled; validate extension + server + foreign table ordering. |

## Prioritized plan

### Phase 1: usage-weighted safety rails

1. Add a canonical Supabase `emptyCatalog`.
2. Reframe the roadmap around the most-used extensions that expose extension-managed state.
3. Add coverage for the highest-usage extensions where generic support should already work but regressions would be costly:
   - type/operator/index extensions (`vector`, `pg_trgm`, `btree_gin`, `btree_gist`, `rum`, `bloom`, `pgroonga`)
   - FDW-backed extensions (`postgres_fdw`, `file_fdw`, `wrappers`)
   - quoted or package-manager style names from database.dev

### Phase 2: first-class handling for top-usage managed extensions

1. Keep `pg_net` and `pgmq` as first-class Supabase integration cases.
2. Decide which filtered schemas should remain baseline-only versus which should surface user-facing managed resources:
   - `graphql` / `graphql_public`
   - `vault`
   - `cron`
   - `net`
3. Document which high-usage extensions pg-delta intentionally treats as “install state only”.

### Phase 3: plugin-oriented service/resource modeling

Treat extension-backed service state as first-class pg-delta objects where that gives the most value, weighted by real usage:

1. `pg_cron` jobs
2. `pgmq` queues
3. `pg_graphql` managed schemas/resources
4. Supabase Vault metadata that is safe to represent without diffing secret payloads
5. `pg_partman` partition-management config

### Phase 4: deeper extension families

1. PostGIS family beyond core `postgis`
2. `timescaledb`
3. `pg_tle` and database.dev package semantics
4. Supabase/product-specific third-party extensions
5. Storage-level engines such as `orioledb`

## High-level plugin implementation options

The current pg-delta pipeline is roughly:

1. extract catalogs
2. diff catalogs object-by-object
3. filter changes through integrations
4. sort and serialize changes

That pipeline is already extensible at the **filter/serialize** layer, but extension-managed state needs hooks **before and during** global diffing, not just after it.

### Option A: post-process-only extension plugins

Each extension plugin would look at the final change list and add/remove extra statements.

**Pros**

- smallest conceptual change
- easy to add incrementally

**Cons**

- too weak for cases like `pg_partman`
- cannot reliably prevent noisy base diff output when the core diff has already emitted objects the extension “owns”
- likely becomes brittle because plugins are patching after the fact

**Assessment**: probably insufficient as the long-term model.

### Option B: pre-diff masking + plugin-managed diff hooks

Each plugin can:

1. detect whether it is active from the installed extension set
2. introspect extension-specific managed state from source and target
3. declare which catalog objects are “plugin-managed” and should be hidden from the base diff
4. emit its own specialized changes
5. merge those changes back into the global change list for sorting/serialization

**Pros**

- fits the `pg_partman` use case well
- lets plugins influence the global diff before noisy changes are emitted
- keeps extension-specific logic isolated

**Cons**

- needs a new lifecycle and registry
- requires careful boundaries between “core-owned” and “plugin-owned” objects

**Assessment**: the best default direction.

### Option C: virtual catalog objects produced by plugins

Plugins would extract their managed state and expose it as synthetic catalog objects, so the main diff engine can compare them similarly to built-in objects.

Examples:

- `pg_cron` plugin exposes “cron job” objects
- `pgmq` plugin exposes “queue” objects
- `pg_partman` plugin exposes “partition config” objects

**Pros**

- most aligned with pg-delta’s existing catalog/diff architecture
- makes plugin-managed state visible to sorting, filtering, and plan reporting
- easier to reason about long-term than opaque post-processing

**Cons**

- requires new core abstractions for plugin-defined models and change types
- bigger upfront design than Option B

**Assessment**: likely the best long-term architecture, but heavier for a first iteration.

### Recommended direction: hybrid of B and C

The most realistic path is:

1. start with a **plugin registry**
2. let plugins participate in **pre-diff masking**
3. let plugins emit **specialized change objects**
4. evolve those change objects toward **first-class virtual catalog objects** once the lifecycle is proven

That gives enough power for `pg_partman`, `pg_cron`, and `pgmq` without forcing a full core redesign on day one.

## Proposed plugin lifecycle

At a high level, a plugin system could look like this:

1. **Discovery**
   - resolve installed extensions from both catalogs
   - activate only plugins whose extension is present in source and/or target
2. **Introspection**
   - plugin reads extension-managed metadata from source and target databases
   - example: cron jobs, queue metadata, partition-management config
3. **Ownership declaration**
   - plugin tells pg-delta which base catalog objects it manages or wants excluded from the raw diff
   - this is the key step for `pg_partman`-style suppression
4. **Core diff**
   - pg-delta diffs the remaining catalog as usual
5. **Plugin diff**
   - plugin produces specialized changes for its managed state
6. **Global merge**
   - merge base changes and plugin changes into a single dependency-aware change list
7. **Sort / serialize**
   - reuse existing sort/serialize machinery as much as possible

## What plugin hooks likely need to exist

- **activation hook**: “is this plugin relevant for these catalogs?”
- **extract hook**: “what managed state does this extension expose?”
- **ownership hook**: “which raw catalog objects should the core diff ignore?”
- **diff hook**: “what specialized changes should be produced?”
- **dependency hook**: “what does each specialized change depend on?”
- **serialize hook**: “how is each specialized change rendered?”

## Which extensions are the best design drivers

If the goal is to validate the plugin architecture rather than support every extension at once, the best first design drivers are:

1. `pg_cron` — clean example of extension-specific managed rows
2. `pgmq` — clear queue-oriented managed state
3. `pg_partman` — proves the “plugin informs global diff” requirement
4. `pg_graphql` — tests filtered-schema / Supabase-managed integration concerns

If those work, the architecture is probably good enough to generalize.

## Explicit non-goals for the first pass

- Promise full support for every extension-owned internal table
- Diff secret values or other sensitive service-managed payloads
- Automatically manage extension version upgrades
- Reverse-engineer every package-manager-specific extension before the baseline work lands

## Recommended output from this plan

After this plan is accepted, the first implementation slice should focus on:

1. Supabase baseline (`emptyCatalog`)
2. coverage for the high-usage “Coverage only” bucket
3. a first plugin-oriented service-modeling target (`pg_cron` or `pgmq`)
4. a narrow plugin lifecycle spike that proves pre-diff masking plus plugin-emitted changes

That gives pg-delta a better Supabase extension story without overcommitting to the hardest extensions first.
