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

### Phase 1: baseline and safety rails

1. Add a canonical Supabase `emptyCatalog`.
2. Freeze this triage into repository docs/tests so extension decisions are explicit.
3. Add coverage for the extension classes most likely to regress:
   - index/operator-class extensions (`pg_trgm`, `vector`, `btree_gin`, `btree_gist`, `rum`, `bloom`, `pgroonga`)
   - FDW-backed extensions (`postgres_fdw`, `file_fdw`, `wrappers`)
   - quoted or package-manager style names from database.dev

### Phase 2: Supabase-specific extension handling

1. Keep `pg_net` and `pgmq` as first-class Supabase integration cases.
2. Decide which filtered schemas should remain baseline-only (`graphql`, `vault`, `pgsodium`) versus which should expose user-facing resources.
3. Document which extensions pg-delta intentionally treats as “install state only”.

### Phase 3: service/resource modeling

Treat extension-backed service state as first-class pg-delta objects where that gives users real migration value:

1. `pg_cron` jobs
2. `pgmq` queues
3. `pg_partman` partition-management config
4. Supabase Vault metadata that is safe to represent without diffing secret payloads

### Phase 4: deep research candidates

Only after the earlier phases are stable:

1. PostGIS family beyond core `postgis`
2. `timescaledb`
3. `pg_tle` and database.dev package semantics
4. Supabase/product-specific third-party extensions
5. Storage-level engines such as `orioledb`

## Explicit non-goals for the first pass

- Promise full support for every extension-owned internal table
- Diff secret values or other sensitive service-managed payloads
- Automatically manage extension version upgrades
- Reverse-engineer every package-manager-specific extension before the baseline work lands

## Recommended output from this plan

After this plan is accepted, the first implementation slice should focus on:

1. Supabase baseline (`emptyCatalog`)
2. coverage for the “Coverage only” bucket
3. a small first service-modeling target (`pg_cron` or `pgmq`)

That gives pg-delta a better Supabase extension story without overcommitting to the hardest extensions first.
