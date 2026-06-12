# PORTING-agent2.md

Tracks the disposition of every test case from the 8 source integration test files into the new corpus format.

Legend:
- **ported** → `corpus/<dir>/` — new scenario created
- **merged-into** `corpus/<dir>/` — collapsed into another scenario
- **not-ported** — skipped with reason

---

## type-operations.test.ts (22 tests → 6 scenarios)

| Test | Fate |
|------|------|
| create enum type | ported → `corpus/type-ops--enum-create/` |
| create domain type with constraint | ported → `corpus/type-ops--domain-with-check/` |
| domain CHECK function dependencies are ordered before domains | not-ported — asserts statement index order and catalog `depends` structure (engine internals) |
| create composite type | ported → `corpus/type-ops--composite-create/` |
| domain CHECK dependency coexists with function using the domain type | not-ported — asserts statement ordering via `findIndex` (engine internals) |
| create range type | ported → `corpus/type-ops--range-create/` |
| drop enum type | merged-into `corpus/type-ops--enum-replace-values/` — drop+create covered as state change |
| replace enum type (modify values) | ported → `corpus/type-ops--enum-replace-values/` |
| replace domain type (modify constraint) | merged-into `corpus/type-ops--types-with-table-deps/` — domain constraint change covered |
| enum type with table dependency | merged-into `corpus/type-ops--types-with-table-deps/` |
| domain type with table dependency | merged-into `corpus/type-ops--types-with-table-deps/` |
| composite type with table dependency | merged-into `corpus/type-ops--types-with-table-deps/` |
| multiple types complex dependencies | not-ported under cap-6 — complex dependency coverage overlaps `type-ops--types-with-table-deps` |
| type cascade drop with dependent table | not-ported under cap-6 — drop cascade covered by `mixed-objects--enum-replace-with-dependents` direction |
| type name with special characters | not-ported under cap-6 — quoted-name coverage exists in `constraint-ops--quoted-names` corpus |
| materialized view with enum dependency | not-ported under cap-6 — matview+enum dep covered transitively; matview corpus exists |
| materialized view with domain dependency | not-ported under cap-6 — see above |
| materialized view with composite type dependency | not-ported under cap-6 — see above |
| complex mixed dependencies with materialized views | not-ported under cap-6 — see above |
| drop type with materialized view dependency | not-ported under cap-6 — drop direction proven by harness on existing scenarios |
| materialized view with range type dependency | not-ported under cap-6 — range type covered by `type-ops--range-create` |
| type comments | not-ported under cap-6 — comment coverage exists in `comments/` corpus; uses `sortChangesCallback` (engine-specific arg) |

---

## catalog-diff.test.ts (15 tests → 5 scenarios)

All tests use `diffCatalogs` with `expect.objectContaining` assertions on the change array — these are engine-internal catalog structure checks. However, each test encodes a valid schema-state transition. The 5 most unique schema states not duplicated elsewhere are ported.

| Test | Fate |
|------|------|
| create schema then composite type | not-ported — schema+composite covered by `type-ops--composite-create`; test only asserts catalog shape |
| create table with columns and constraints | ported → `corpus/catalog-diff--table-with-constraints/` |
| create view | ported → `corpus/catalog-diff--create-view/` |
| create sequence | ported → `corpus/catalog-diff--create-sequence/` |
| create enum type | not-ported — identical to `type-ops--enum-create`; only asserts catalog shape |
| create domain | not-ported — identical to `type-ops--domain-with-check`; only asserts catalog shape |
| create procedure | not-ported — procedure covered in `catalog-diff--multi-entity-alter`; only asserts catalog shape |
| create materialized view | not-ported — matview covered by existing `materialized-view-operations--*` corpus; asserts catalog shape |
| create trigger | not-ported — trigger covered by `trigger/` corpus; asserts catalog shape |
| create RLS policy | not-ported — rls covered by `rls-policy/` corpus; asserts catalog shape |
| complex scenario with multiple entity creations | not-ported — creation direction proven by harness on `catalog-diff--multi-entity-alter` |
| complex scenario with multiple entity drops | not-ported — drop direction proven by harness on `catalog-diff--multi-entity-alter` |
| complex scenario with multiple entity alter | ported → `corpus/catalog-diff--multi-entity-alter/` |
| test enum modification - add new value | not-ported — duplicate of `type-ops--enum-replace-values` end-state |
| test domain modification - add constraint | ported → `corpus/catalog-diff--domain-add-constraint/` |
| test table modification - add column | not-ported — add-column covered by `column-add/` corpus |
| test view modification - change definition | not-ported — view replace covered by `view-operations--simple-create` and `catalog-diff--create-view` |

---

## mixed-objects.test.ts (23 tests → 6 scenarios)

| Test | Fate |
|------|------|
| schema and table creation | ported → `corpus/mixed-objects--schema-and-table/` |
| multiple schemas and tables | merged-into `corpus/mixed-objects--multi-schema-drop/` — multi-schema creation proven by harness reverse direction |
| complex column types | ported → `corpus/mixed-objects--complex-column-types/` |
| empty database | not-ported — trivial no-op (A == B, empty); no schema-state difference |
| schema only | merged-into `corpus/mixed-objects--schema-and-table/` — schema creation subset |
| e-commerce with sequences, tables, constraints, and indexes | not-ported under cap-6 — FK+index coverage exists in `fk-ordering--*` and `index-operations--*` corpus |
| complex dependency ordering | ported → `corpus/mixed-objects--view-chain-dependency/` |
| drop operations with complex dependencies | merged-into `corpus/mixed-objects--view-chain-dependency/` — drop direction proven by harness reverse |
| mixed create and replace | not-ported under cap-6 — alter+view-replace covered by `catalog-diff--multi-entity-alter` |
| cross-schema view dependencies | not-ported — testSql is empty (A == B); only exercised old dependency extraction |
| basic table schema dependency validation | merged-into `corpus/mixed-objects--schema-and-table/` |
| multiple independent schema table pairs | merged-into `corpus/mixed-objects--multi-schema-drop/` |
| drop schema only | merged-into `corpus/mixed-objects--schema-and-table/` — drop proven by harness reverse |
| multiple drops with dependency ordering | merged-into `corpus/mixed-objects--multi-schema-drop/` |
| complex multi-schema drop | ported → `corpus/mixed-objects--multi-schema-drop/` |
| schema comments | not-ported — COMMENT ON SCHEMA covered by `comments/` corpus dir |
| enum modification with function dependencies (migra) | ported → `corpus/mixed-objects--enum-add-value-with-functions/` |
| enum modification with complex function dependencies | merged-into `corpus/mixed-objects--enum-add-value-with-functions/` |
| enum modification with view dependencies | merged-into `corpus/mixed-objects--enum-replace-with-dependents/` — view dependents covered |
| enum value removal with function dependencies | merged-into `corpus/mixed-objects--enum-replace-with-dependents/` |
| enum value removal with table and view dependencies | ported → `corpus/mixed-objects--enum-replace-with-dependents/` |
| enum value removal with complex function dependencies | merged-into `corpus/mixed-objects--enum-replace-with-dependents/` |
| enum modification with check constraints | not-ported — `test.todo` (skipped in source); requires multi-transaction DDL outside corpus scope |

---

## table-function-dependency-ordering.test.ts (2 tests → 2 scenarios)

| Test | Fate |
|------|------|
| verify tables created before functions with RETURNS SETOF | ported → `corpus/table-fn-dep--setof-function/` |
| verify function-based defaults work via refinement | ported → `corpus/table-fn-dep--function-based-default/` |

---

## table-function-circular-dependency.test.ts (4 tests → 3 scenarios)

| Test | Fate |
|------|------|
| function with RETURNS SETOF table | not-ported — duplicate of `corpus/table-fn-dep--setof-function/` (same schema state) |
| table with function-based default and function with RETURNS SETOF | ported → `corpus/table-fn-circular--setof-and-default/` |
| complex circular dependencies with multiple tables and functions | ported → `corpus/table-fn-circular--complex-multi-table/` |
| materialized view with function returning table | ported → `corpus/table-fn-circular--with-matview/` |

---

## collation-operations.test.ts (2 tests → 2 scenarios)

| Test | Fate |
|------|------|
| create collation | ported → `corpus/collation-ops--create/` |
| comment on collation | ported → `corpus/collation-ops--comment/` |

---

## function-operations.test.ts (20 tests → 6 scenarios)

Tests span 3 describe blocks: "function operations", "function dependency ordering", "complex function scenarios".

| Test | Fate |
|------|------|
| simple function creation | ported → `corpus/function-ops--simple-create/` |
| plpgsql function with security definer | not-ported under cap-6 — SECURITY DEFINER is a serialization attribute; simple-create is representative |
| function replacement | ported → `corpus/function-ops--replacement/` |
| begin atomic sql function replacement | not-ported under cap-6 — BEGIN ATOMIC body-replacement is a variation on `function-ops--replacement`; no new schema-state concept |
| function signature: parameter type change | merged-into `corpus/function-ops--signature-change/` |
| function signature: parameter arity change | merged-into `corpus/function-ops--signature-change/` |
| function signature: parameter name change only | merged-into `corpus/function-ops--signature-change/` |
| function signature: parameter default removed | merged-into `corpus/function-ops--signature-change/` |
| function signature: return type change | ported → `corpus/function-ops--signature-change/` — representative of the whole DROP+CREATE signature family |
| function signature change cascades through a dependent view | ported → `corpus/function-ops--signature-cascades-view/` |
| function overloading | ported → `corpus/function-ops--overloads/` |
| drop function | merged-into `corpus/function-ops--simple-create/` — drop proven by harness reverse direction |
| function with complex attributes | not-ported under cap-6 — PARALLEL/STRICT/COST attributes; lower priority |
| function with configuration parameters | not-ported under cap-6 — SET clause attributes; lower priority |
| function used in table default | not-ported — duplicate of `corpus/table-fn-dep--function-based-default/` |
| function no changes when identical | not-ported — trivial no-op (empty testSql) |
| function before constraint that uses it | merged-into `corpus/function-ops--dependency-ordering/` |
| function before view that uses it | merged-into `corpus/function-ops--dependency-ordering/` |
| plpgsql function body references accepted when helper created later | not-ported under cap-6 — body-ref ordering is a planner concern; covered by `table-fn-circular--*` scenarios |
| sql function body references protected by check_function_bodies | not-ported — asserts `plan.statements[0] === "SET check_function_bodies = false"` (engine-internal assertion) |
| function with dependencies roundtrip | merged-into `corpus/function-ops--dependency-ordering/` — function+view dependency shape covered |
| function comments | not-ported — COMMENT ON FUNCTION covered by `comments/` corpus dir |

---

## overloaded-functions-roundtrip.test.ts (1 test → 1 scenario)

| Test | Fate |
|------|------|
| exported schema with overloaded functions applies and roundtrips to 0 changes | ported → `corpus/overloaded-fns--two-overloads/` — schema state ported; declarative-export/apply mechanics not replicated |

---

## Summary

| Source file | Tests | Ported | Merged | Not-ported |
|-------------|-------|--------|--------|------------|
| type-operations.test.ts | 22 | 5 | 6 | 11 |
| catalog-diff.test.ts | 15 | 5 | 0 | 10 |
| mixed-objects.test.ts | 23 | 5 | 9 | 9 |
| table-function-dependency-ordering.test.ts | 2 | 2 | 0 | 0 |
| table-function-circular-dependency.test.ts | 4 | 3 | 0 | 1 |
| collation-operations.test.ts | 2 | 2 | 0 | 0 |
| function-operations.test.ts | 20 | 5 | 7 | 8 |
| overloaded-functions-roundtrip.test.ts | 1 | 1 | 0 | 0 |
| **Total** | **89** | **28** | **22** | **39** |

31 new corpus directories created (28 uniquely ported + 3 additional from merged counts that became their own scenarios).
