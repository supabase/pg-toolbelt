/**
 * Integration tests to identify and validate dependency cycles in statement sorting.
 *
 * This test suite focuses on identifying the specific cycles that occur when
 * sorting statements, particularly the cycle between sequences owned by columns
 * and tables created with columns that reference those sequences via DEFAULT.
 */

import { describe, test } from "bun:test";
import type { PgDepend } from "../../src/core/depend.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`dependency cycles (pg${pgVersion})`, () => {
    test(
      "sequence owned by column cycle with table default",
      withDb(pgVersion, async (db) => {
        /**
         * This test identifies the ONLY current cycle we have when sorting statements:
         *
         * CYCLE DESCRIPTION:
         * - A sequence is owned by a table column (via OWNED BY)
         * - A table is created with a column that uses that sequence via DEFAULT nextval(...)
         *
         * DEPENDENCIES CREATING THE CYCLE:
         * 1. Column default (pg_attrdef) → Sequence (via pg_depend: column default depends on sequence)
         *    - This creates: column:test_schema.users.id → sequence:test_schema.user_id_seq
         * 2. Sequence → Column/Table (via pg_depend: sequence ownership, deptype='a')
         *    - This creates: sequence:test_schema.user_id_seq → column:test_schema.users.id
         *    - OR: sequence:test_schema.user_id_seq → table:test_schema.users
         *
         * CYCLE PATH:
         * sequence:test_schema.user_id_seq → column:test_schema.users.id → sequence:test_schema.user_id_seq
         * OR
         * sequence:test_schema.user_id_seq → table:test_schema.users → sequence:test_schema.user_id_seq
         *
         * HOW IT'S BROKEN:
         * The dependency-filter.ts filters out the ownership dependency FROM the sequence
         * TO the table/column it's owned by, breaking the cycle. This is safe because:
         * - CREATE phase: sequences should be created before tables (ownership set via ALTER SEQUENCE OWNED BY after both exist)
         * - DROP phase: prevents cycles when dropping sequences owned by tables that aren't being dropped
         *
         * EXPECTED ORDER (after cycle breaking):
         * 1. CREATE SEQUENCE (no dependencies)
         * 2. CREATE TABLE (depends on sequence via column default)
         * 3. ALTER SEQUENCE OWNED BY (depends on table/column)
         */
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE SEQUENCE test_schema.user_id_seq;

          CREATE TABLE test_schema.users (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq')
          );

          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
          // Validate the expected order: sequence → table → alter sequence → constraint
          // Note: PRIMARY KEY constraint is added as a separate ALTER TABLE statement
          expectedSqlTerms: [
            "CREATE SEQUENCE test_schema.user_id_seq",
            "CREATE TABLE test_schema.users (id bigint DEFAULT nextval('test_schema.user_id_seq'::regclass) NOT NULL)",
            "ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id",
            "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
          ],
          // Validate the dependencies that create the cycle
          expectedBranchDependencies: [
            // Column default depends on sequence (creates: column → sequence)
            {
              dependent_stable_id: "column:test_schema.users.id",
              referenced_stable_id: "sequence:test_schema.user_id_seq",
              deptype: "n", // or "a" - normal or auto dependency
            },
            // Sequence ownership dependency (creates: sequence → column/table, deptype='a')
            // This is the dependency that gets filtered to break the cycle
            {
              dependent_stable_id: "sequence:test_schema.user_id_seq",
              referenced_stable_id: "column:test_schema.users.id",
              deptype: "a", // auto dependency for ownership
            },
          ] as PgDepend[],
        });
      }),
    );

    test(
      "sequence owned by column cycle with ADD COLUMN SET DEFAULT",
      withDb(pgVersion, async (db) => {
        /**
         * This test verifies that the same cycle exists when using ADD COLUMN SET DEFAULT
         * on a pre-existing table instead of CREATE TABLE with DEFAULT.
         *
         * CYCLE DESCRIPTION:
         * - A sequence is owned by a table column (via OWNED BY)
         * - An existing table has a column added that uses that sequence via DEFAULT nextval(...)
         *
         * DEPENDENCIES CREATING THE CYCLE:
         * Same as the CREATE TABLE case:
         * 1. Column default (pg_attrdef) → Sequence (via pg_depend: column default depends on sequence)
         *    - This creates: column:test_schema.users.id → sequence:test_schema.user_id_seq
         * 2. Sequence → Column/Table (via pg_depend: sequence ownership, deptype='a')
         *    - This creates: sequence:test_schema.user_id_seq → column:test_schema.users.id
         *
         * EXPECTED ORDER (after cycle breaking):
         * 1. CREATE SEQUENCE (no dependencies)
         * 2. ALTER TABLE ADD COLUMN SET DEFAULT (depends on sequence via column default)
         * 3. ALTER SEQUENCE OWNED BY (depends on table/column)
         */
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            name text NOT NULL
          );
        `,
          testSql: `
          CREATE SEQUENCE test_schema.user_id_seq;

          ALTER TABLE test_schema.users
          ADD COLUMN id bigint DEFAULT nextval('test_schema.user_id_seq');

          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
          // Validate the expected order: sequence → alter table add column → alter sequence
          expectedSqlTerms: [
            "CREATE SEQUENCE test_schema.user_id_seq",
            "ALTER TABLE test_schema.users ADD COLUMN id bigint DEFAULT nextval('test_schema.user_id_seq'::regclass)",
            "ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id",
          ],
        });
      }),
    );

    test(
      "drop two tables with mutual FK references should not produce a cycle",
      withDb(pgVersion, async (db) => {
        /**
         * REPRODUCTION for CycleError seen in production:
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [n] DropTable
         *     2. [m] DropTable
         *   [n] → [m] constraint:public.a.a_b_fkey → column:public.b.id
         *   [m] → [n] constraint:public.b.b_a_fkey → column:public.a.id
         *
         * Two tables each hold a FK pointing at the other; both are absent
         * from branch so both must be dropped. The pg_depend graph for the FK
         * constraints creates:
         *   constraint(A) → column(B.id) → table(B)
         *   constraint(B) → column(A.id) → table(A)
         * So DropTable(A) requires DropTable(B) AND DropTable(B) requires
         * DropTable(A) → cycle that the current cycle-breaking filter
         * (CreateSequence-only) does not handle.
         *
         * Expected: either (a) FK constraints are dropped first, or
         * (b) the sort layer breaks the FK edge when both referenced objects
         * are in DropTable changes in the same phase.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.a (
              id bigserial PRIMARY KEY,
              name text NOT NULL
            )`,
            `CREATE TABLE public.b (
              id bigserial PRIMARY KEY,
              name text NOT NULL,
              a_id bigint REFERENCES public.a(id)
            )`,
            `ALTER TABLE public.a
              ADD COLUMN b_id bigint`,
            `ALTER TABLE public.a
              ADD CONSTRAINT a_b_fkey
              FOREIGN KEY (b_id)
              REFERENCES public.b(id)`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "sequence owned by column cycle - multiple sequences",
      withDb(pgVersion, async (db) => {
        /**
         * Test multiple sequences with the same cycle pattern to ensure
         * the cycle-breaking logic works consistently across multiple objects.
         *
         * This test verifies that the cycle-breaking filter works correctly
         * even when there are multiple independent cycles in the same migration.
         * The exact order of independent sequences/tables may vary, but the
         * important thing is that cycles are broken and the migration succeeds.
         */
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE SEQUENCE test_schema.order_id_seq;
          CREATE SEQUENCE test_schema.item_id_seq;

          CREATE TABLE test_schema.orders (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.order_id_seq')
          );

          CREATE TABLE test_schema.items (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.item_id_seq')
          );

          ALTER SEQUENCE test_schema.order_id_seq OWNED BY test_schema.orders.id;
          ALTER SEQUENCE test_schema.item_id_seq OWNED BY test_schema.items.id;
        `,
          // No strict ordering check - independent sequences/tables can be in any order
          // The important thing is that cycles are broken and migration succeeds
        });
      }),
    );
  });
}
