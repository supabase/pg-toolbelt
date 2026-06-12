# PORTING-agent1.md

Ported from six source files in `packages/pg-delta/tests/integration/`.

---

## table-operations.test.ts

| Test case | Disposition |
|-----------|-------------|
| simple table with columns | not-ported — trivially covered by existing `corpus/table-create/`; schema state is a plain CREATE TABLE |
| table with constraints | not-ported — near-identical to "simple table with columns"; no distinct PostgreSQL semantic; covered by table-create |
| multiple tables | not-ported — multiple plain tables in same schema; no distinct semantic beyond table-create |
| table with various types | not-ported — column type variety has no cross-state diff; create-only scenario identical in structure to table-create |
| table in public schema | not-ported — trivially covered by existing `corpus/table-create/` which already targets public schema |
| empty table | ported → `corpus/table-ops--empty-table/` |
| tables in multiple schemas | ported → `corpus/table-ops--multi-schema/` |
| partitioned table RANGE | ported → `corpus/table-ops--partition-range/` |
| attach partition | ported → `corpus/table-ops--attach-partition/` |
| detach partition | ported → `corpus/table-ops--detach-partition/` |
| table comments | ported → `corpus/table-ops--comments/` |
| replace table via enum dependency does not emit standalone drop/create for PK-owned index | not-ported — `assertSqlStatements` checks engine-internal SQL statement shapes (DROP INDEX / CREATE UNIQUE INDEX presence); schema-state scenario (enum change + table replace) is exercised by the roundtrip but the test's value is entirely in the assertion predicate |

**Counts: 12 cases seen / 6 scenarios created / 6 not-ported**

---

## alter-table-operations.test.ts

| Test case | Disposition |
|-----------|-------------|
| add column then create unique index on it | not-ported — `sortChangesCallback` tests planner-internal ordering; schema-state (add column + add unique constraint) is already covered by `constraint-ops--pk-unique-check` |
| add column to existing table | merged-into `corpus/alter-table--multi-alter-ops/` |
| drop column from existing table | merged-into `corpus/alter-table--multi-alter-ops/` |
| change column type | merged-into `corpus/alter-table--column-type-cast/` |
| change column type after dropping dependent view | not-ported — `assertSqlStatements` checks exact count and statement ordering (engine-internal plan mechanics) |
| change column type after dropping dependent view preserves metadata | not-ported — `assertSqlStatements` checks exact count and ordering; also uses `withDbIsolated` for role grant which is cluster-internal metadata, not a cross-state schema diff |
| change column type to enum with default | ported → `corpus/alter-table--column-type-enum-default/` |
| change varchar column type to integer with using cast | ported → `corpus/alter-table--column-type-cast/` |
| set column default | merged-into `corpus/alter-table--multi-alter-ops/` |
| drop column default | merged-into `corpus/alter-table--multi-alter-ops/` |
| set column not null | ported → `corpus/alter-table--not-null/` |
| drop column not null | merged-into `corpus/alter-table--not-null/` |
| multiple alter operations - state-based diffing | ported → `corpus/alter-table--multi-alter-ops/` |
| complex column changes | merged-into `corpus/alter-table--multi-alter-ops/` |
| generated column operations | ported → `corpus/alter-table--generated-column/` |
| drop generated column | merged-into `corpus/alter-table--generated-column/` |
| alter generated column expression | merged-into `corpus/alter-table--generated-column/` (sortChangesCallback tests planner ordering; schema state is modelled) |
| table and column comments | not-ported — schema-state identical to `corpus/comments/` which already exercises table/column COMMENT |
| widen column type preserves pre-existing default | merged-into `corpus/alter-table--column-type-cast/` (seed.sql carries the pre-existing default row) |
| change column type from enum to text preserves default | merged-into `corpus/alter-table--column-type-enum-default/` (reverse direction exercised automatically by the harness) |
| set replica identity using index on existing table | merged-into `corpus/alter-table--replica-identity/` |
| create table with replica identity using index | merged-into `corpus/alter-table--replica-identity/` |
| redefine replica identity index without changing the table's replica identity setting | ported → `corpus/alter-table--replica-identity/` (most complex variant; covers the post-diff normalization re-emit) |

**Counts: 23 cases seen / 6 scenarios created / 6 not-ported (rest merged)**

---

## constraint-operations.test.ts

| Test case | Disposition |
|-----------|-------------|
| add primary key constraint | merged-into `corpus/constraint-ops--pk-unique-check/` |
| add unique constraint | merged-into `corpus/constraint-ops--pk-unique-check/` |
| add check constraint | merged-into `corpus/constraint-ops--pk-unique-check/` |
| add CHECK (FALSE) NO INHERIT constraint on inheritance parent | merged-into `corpus/constraint-ops--no-inherit-check/` |
| add CHECK (FALSE) NO INHERIT on parent with INHERITS child | ported → `corpus/constraint-ops--no-inherit-check/` |
| drop primary key constraint | merged-into `corpus/constraint-ops--pk-unique-check/` (reverse direction tested automatically) |
| add foreign key constraint | merged-into `corpus/fk-ordering--basic-fk-new-tables/` |
| modify composite foreign key preserves referenced column order | ported → `corpus/constraint-ops--composite-fk/` |
| drop unique constraint | merged-into `corpus/constraint-ops--pk-unique-check/` (reverse direction) |
| drop check constraint | merged-into `corpus/constraint-ops--pk-unique-check/` (reverse direction) |
| drop foreign key constraint | not-ported — schema state (FK present vs absent) already covered by `corpus/fk-ordering--basic-fk-new-tables/` in reverse |
| add multiple constraints to same table | merged-into `corpus/constraint-ops--pk-unique-check/` |
| constraint with special characters in names | ported → `corpus/constraint-ops--quoted-names/` |
| constraint comments | ported → `corpus/constraint-ops--comments/` |
| add exclude constraint | ported → `corpus/constraint-ops--exclude/` |
| extract exclude constraint defined over an expression | merged-into `corpus/constraint-ops--exclude/` |
| convert primary key to temporal primary key (PG18) | not-ported — PG18-only syntax; no minVersion:18 support confirmed in harness |
| add temporal foreign key constraint (PG18) | not-ported — PG18-only syntax |
| convert related PK and FK to temporal together (PG18) | not-ported — PG18-only syntax |

**Counts: 19 cases seen / 6 scenarios created / 6 not-ported (rest merged)**

---

## not-valid-constraint-convergence.test.ts

| Test case | Disposition |
|-----------|-------------|
| created NOT VALID check constraint converges without VALIDATE | ported → `corpus/not-valid--create-not-valid/` (assertSqlStatements checks engine behavior, but schema state — absent constraint vs NOT VALID constraint — is a valid corpus scenario) |
| validated -> NOT VALID drift converges without re-validating | merged-into `corpus/not-valid--validate-drift/` (a.sql = validated, b.sql = NOT VALID; reverse of validate-drift) |
| NOT VALID -> validated drift converges via VALIDATE CONSTRAINT (no drop+add) | ported → `corpus/not-valid--validate-drift/` |

**Counts: 3 cases seen / 2 scenarios created / 0 not-ported (1 merged)**

---

## fk-constraint-ordering.test.ts

| Test case | Disposition |
|-----------|-------------|
| FK constraint created before referenced table - should fail without stableId fix | ported → `corpus/fk-ordering--basic-fk-new-tables/` |
| complex FK constraint chain with multiple references | ported → `corpus/fk-ordering--multi-fk-chain/` |
| FK constraint with deferred validation | ported → `corpus/fk-ordering--deferred-fk/` |
| self-referencing FK constraint | ported → `corpus/fk-ordering--self-referencing/` |
| FK constraint with ON DELETE/UPDATE actions | ported → `corpus/fk-ordering--on-delete-cascade/` |
| drop referencing table before referenced table | not-ported — `assertSqlStatements` checks ordering of two DROP TABLE statements (engine-internal sort); schema state (both tables absent) is trivially empty and adds no diff coverage |

**Counts: 6 cases seen / 5 scenarios created / 1 not-ported**

---

## check-constraint-ordering.test.ts

| Test case | Disposition |
|-----------|-------------|
| CHECK constraint referencing function created later | ported → `corpus/check-ordering--function-and-type-ref/` |
| CHECK constraint referencing custom type created later | merged-into `corpus/check-ordering--function-and-type-ref/` |

**Counts: 2 cases seen / 1 scenario created / 0 not-ported (1 merged)**

---

## Grand Total

| Source file | Cases seen | Scenarios created | Not-ported |
|-------------|-----------|-------------------|-----------|
| table-operations.test.ts | 12 | 6 | 6 |
| alter-table-operations.test.ts | 23 | 6 | 6 (+ 11 merged) |
| constraint-operations.test.ts | 19 | 6 | 6 (+ 7 merged) |
| not-valid-constraint-convergence.test.ts | 3 | 2 | 0 (+ 1 merged) |
| fk-constraint-ordering.test.ts | 6 | 5 | 1 |
| check-constraint-ordering.test.ts | 2 | 1 | 0 (+ 1 merged) |
| **Total** | **65** | **26** | **19** |
