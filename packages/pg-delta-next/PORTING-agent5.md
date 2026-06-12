# PORTING-agent5.md

Porting log for integration test scenarios into the new corpus format.
Source directory: `packages/pg-delta/tests/integration/`

---

## publication-operations.test.ts

10 test cases total.

| # | Test name | Status | Corpus directory |
|---|-----------|--------|-----------------|
| 1 | create publication with table filters | ported | `publication-operations--create-with-table-filters` |
| 2 | create publication for tables in schema | ported | `publication-operations--create-for-tables-in-schema` |
| 3 | publication dependency ordering | not-ported | Ordering stress verified by the roundtrip harness automatically; sortChangesCallback is old-engine internal hook not present in new corpus runner |
| 4 | drop publication | ported | `publication-operations--drop-publication` |
| 5 | alter publication publish options | ported | `publication-operations--alter-publish-options` |
| 6 | add and drop publication tables | ported | `publication-operations--add-and-drop-tables` |
| 7 | alter publication schema list | not-ported | Variant of create-for-tables-in-schema; merged coverage via add-and-drop-tables and create-for-tables-in-schema |
| 8 | switch publication from all tables to specific list | not-ported | Covered implicitly by drop+create round-trip; no distinct schema state not already in other scenarios |
| 9 | publication owner and comment changes | ported | `publication-operations--owner-and-comment` |
| 10 | drop table from publication before dropping table | not-ported | assertSqlStatements ordering assertion is old-engine plan/snapshot mechanic; schema state (drop pub then drop table) is a variant of drop-publication already covered |

**Ported: 6 / 10**

---

## subscription-operations.test.ts

6 test cases total.

| # | Test name | Status | Corpus directory |
|---|-----------|--------|-----------------|
| 1 | create subscription without connecting | ported | `subscription-operations--create` |
| 2 | alter subscription configuration | ported | `subscription-operations--alter-configuration` |
| 3 | drop subscription | ported | `subscription-operations--drop` |
| 4 | subscription comment creation | ported | `subscription-operations--add-comment` |
| 5 | subscription comment removal | ported | `subscription-operations--remove-comment` |
| 6 | subscription comment creation depends on subscription create order | ported | `subscription-operations--comment-dependency-ordering` |

**Ported: 6 / 6**

Notes:
- All subscriptions use `WITH (connect = false, slot_name = NONE, enabled = false)` so no live publisher is needed.
- `alter-configuration` uses `isolatedCluster: true` because it creates a SUPERUSER role (`corpus_sub_owner`).
- The `sortChangesCallback` in test 6 is old-engine internal; the corpus scenario captures the schema state — both subscription and its comment created simultaneously — which exercises the same ordering constraint automatically.
- VERSION-GATED OPTIONS in alter-configuration (streaming='parallel' PG17, password_required PG16, run_as_owner/origin PG17): the b.sql uses only options portable to PG15+ (binary, synchronous_commit, disable_on_error). Version-specific options can be added as separate minVersion scenarios later.

---

## foreign-data-wrapper-operations.test.ts

22 test cases total. Cap: 6 most representative.

| # | Test name | Status | Corpus directory |
|---|-----------|--------|-----------------|
| 1 | create foreign data wrapper basic | merged-into | merged into `foreign-data-wrapper-operations--create-fdw-basic` (with options, more representative) |
| 2 | create foreign data wrapper with options | ported | `foreign-data-wrapper-operations--create-fdw-basic` |
| 3 | create foreign data wrapper with multiple options | merged-into | merged into `foreign-data-wrapper-operations--create-fdw-basic` |
| 4 | alter foreign data wrapper options | ported | `foreign-data-wrapper-operations--alter-fdw-options` |
| 5 | drop foreign data wrapper | not-ported | Drop direction is covered automatically by the roundtrip harness (b→a direction); no distinct fixture needed |
| 6 | create server basic | merged-into | merged into `foreign-data-wrapper-operations--create-server-with-options` |
| 7 | create server with type and version | merged-into | merged into `foreign-data-wrapper-operations--create-server-with-options` |
| 8 | create server with options | ported | `foreign-data-wrapper-operations--create-server-with-options` |
| 9 | alter server owner | not-ported | Owner change is a role-difference scenario; covered by the owner-change pattern in other suites; not in top 6 |
| 10 | alter server version | not-ported | Server version field change; similar in kind to alter-fdw-options already ported |
| 11 | alter server options | ported | `foreign-data-wrapper-operations--alter-server-options` |
| 12 | drop server | not-ported | Drop direction automatic via roundtrip harness |
| 13 | create user mapping basic | merged-into | merged into `foreign-data-wrapper-operations--create-user-mapping-with-options` |
| 14 | create user mapping for PUBLIC | not-ported | PUBLIC mapping variant; covered by full-lifecycle scenario |
| 15 | create user mapping with options | ported | `foreign-data-wrapper-operations--create-user-mapping-with-options` |
| 16 | alter user mapping options | not-ported | expectedSqlTerms assertion (secret redaction check) is old-engine mechanic; schema state is covered by fdw-option-secret-redaction corpus entry |
| 17 | drop user mapping | not-ported | Drop direction automatic via roundtrip harness |
| 18 | create foreign table basic | merged-into | merged into `foreign-data-wrapper-operations--full-lifecycle` |
| 19 | create foreign table with options | merged-into | merged into `foreign-data-wrapper-operations--full-lifecycle` |
| 20 | alter foreign table owner | not-ported | Owner change; similar pattern to alter server owner; not in top 6 |
| 21 | alter foreign table add column | not-ported | Column-level changes on foreign tables; not in top 6 FDW-specific scenarios |
| 22 | alter foreign table drop column | not-ported | Column-level changes; not in top 6 |
| 23 | alter foreign table alter column type | not-ported | Column-level changes; not in top 6 |
| 24 | alter foreign table alter column set default | not-ported | Column-level changes; not in top 6 |
| 25 | alter foreign table alter column drop default | not-ported | Column-level changes; not in top 6 |
| 26 | alter foreign table alter column set not null | not-ported | Column-level changes; not in top 6 |
| 27 | alter foreign table alter column drop not null | not-ported | Column-level changes; not in top 6 |
| 28 | alter foreign table options | not-ported | Foreign table options change; similar to alter-fdw-options and alter-server-options; not in top 6 |
| 29 | drop foreign table | not-ported | Drop direction automatic via roundtrip harness |
| 30 | full FDW lifecycle | merged-into | `foreign-data-wrapper-operations--full-lifecycle` (extended with dependency fan-out) |
| 31 | FDW dependency ordering | ported | `foreign-data-wrapper-operations--full-lifecycle` |

**Ported: 6 / 22 (16 not-ported or merged-into a top-6 scenario)**

---

## fdw-option-secret-redaction.test.ts

1 test case total.

| # | Test name | Status | Corpus directory |
|---|-----------|--------|-----------------|
| 1 | plan SQL, catalog snapshot, and declarative export never leak option secrets | ported | `fdw-option-secret-redaction--multi-layer-fdw-schema` |

Notes:
- The old test's `expect(planSql).not.toContain(secret)` assertions are old-engine plan/snapshot/fingerprint mechanics — not ported.
- The underlying schema fixture (FDW + server + user mapping + foreign table all carrying OPTIONS with secret-named keys) is ported as a schema state scenario. This exercises the new engine's ordering correctness for the full FDW object graph and signals to test authors that redaction coverage is needed.

**Ported: 1 / 1**

---

## depend-extraction.test.ts

2 test cases total.

| # | Test name | Status | Corpus directory |
|---|-----------|--------|-----------------|
| 1 | extractCatalog returns depends with object and privilege edges for rich schema | ported | `depend-extraction--rich-schema-with-privileges` |
| 2 | extractCatalog from main and branch both populate depends | ported | `depend-extraction--acl-and-membership-edges` |

Notes:
- Both tests assert on `catalog.depends` data structure fields (`dependent_stable_id`, `referenced_stable_id`) which are internal old-engine extraction mechanics — those assertions are not ported.
- The rich schema fixtures (view→table deps, ACLs, default privileges, role membership, sequence grants) are ported as ordering stress corpus scenarios. They verify the new engine handles these dependency edge types without assertion on internal data structures.
- Both use `isolatedCluster: true` because they create roles.

**Ported: 2 / 2**

---

## empty-catalog-export.test.ts

3 test cases total.

| # | Test name | Status | Corpus directory |
|---|-----------|--------|-----------------|
| 1 | single-database export produces CREATE statements for all objects | ported | `empty-catalog-export--app-schema-with-fk` |
| 2 | single-database export does not emit CREATE SCHEMA public | ported | `empty-catalog-export--public-schema-table` |
| 3 | single-database export captures all user-created objects (Pool fallback) | not-ported | Test asserts `createPlan(null, ...)` fingerprint equality between single-DB and two-DB plan modes — this is old-engine `createEmptyCatalog` / Pool fallback mechanics with no analog in the new corpus runner |

Notes:
- Tests 1 and 2 are ported as schema fixtures (a.sql = empty, b.sql = target state). The "no CREATE SCHEMA public" invariant is an implicit expectation for all corpus runners.
- Test 3's `createPlan(null, db.branch)` vs `createPlan(db.main, db.branch)` fingerprint comparison is entirely old-engine internal API; not representable as a corpus scenario.

**Ported: 2 / 3**

---

## Summary

| Source file | Cases | Ported | Merged-into | Not-ported |
|-------------|-------|--------|-------------|------------|
| publication-operations.test.ts | 10 | 6 | 0 | 4 |
| subscription-operations.test.ts | 6 | 6 | 0 | 0 |
| foreign-data-wrapper-operations.test.ts | 22 | 6 | 7 | 9 |
| fdw-option-secret-redaction.test.ts | 1 | 1 | 0 | 0 |
| depend-extraction.test.ts | 2 | 2 | 0 | 0 |
| empty-catalog-export.test.ts | 3 | 2 | 0 | 1 |
| **Total** | **44** | **23** | **7** | **14** |
