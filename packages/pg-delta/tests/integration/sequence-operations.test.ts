/**
 * Integration tests for PostgreSQL sequence operations.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`sequence operations (pg${pgVersion})`, () => {
    test(
      "create basic sequence",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: "CREATE SEQUENCE test_schema.test_seq;",
        });
      }),
    );

    test(
      "create sequence with options",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE SEQUENCE test_schema.custom_seq
            AS integer
            INCREMENT BY 2
            MINVALUE 10
            MAXVALUE 1000
            START WITH 10
            CACHE 5
            CYCLE;
        `,
        });
      }),
    );

    test(
      "drop sequence",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.test_seq;
        `,
          testSql: "DROP SEQUENCE test_schema.test_seq;",
        });
      }),
    );

    test(
      "create table with serial column (sequence dependency)",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.users (
            id SERIAL PRIMARY KEY,
            name TEXT
          );
        `,
        });
      }),
    );

    test(
      "alter sequence properties",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.test_seq INCREMENT BY 1 CACHE 1;
        `,
          testSql: `
          ALTER SEQUENCE test_schema.test_seq INCREMENT BY 5 CACHE 10;
        `,
        });
      }),
    );

    test(
      "sequence comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.seq1;
        `,
          testSql: `
          COMMENT ON SEQUENCE test_schema.seq1 IS 'test sequence comment';
        `,
        });
      }),
    );

    test(
      "drop table with owned sequence (skips DROP SEQUENCE)",
      withDb(pgVersion, async (db) => {
        // This test verifies that the diff tool correctly skips generating DROP SEQUENCE
        // when a sequence is owned by a table that's being dropped.
        //
        // Scenario:
        // 1. Sequence is owned by a table column
        // 2. Table uses the sequence in a default (nextval)
        // 3. Table is dropped
        //
        // When PostgreSQL drops a table that owns a sequence, it automatically drops
        // the sequence as well. The diff tool should detect this and skip generating
        // DROP SEQUENCE to avoid migration errors (sequence doesn't exist).
        //
        // Expected: Only DROP TABLE is generated (no DROP SEQUENCE)
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.user_id_seq;
          CREATE TABLE test_schema.users (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq')
          );
          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
          testSql: `
          DROP TABLE test_schema.users;
        `,
          // Validate that only DROP TABLE is generated
          // The sequence is owned by the table, so PostgreSQL auto-drops it when the table is dropped.
          // The diff tool correctly skips generating DROP SEQUENCE to avoid errors.
          expectedSqlTerms: ["DROP TABLE test_schema.users"],
        });
      }),
    );

    test(
      "alter owned sequence data_type in place keeps OWNED BY and column default",
      withDb(pgVersion, async (db) => {
        // Previously this scenario emitted DROP SEQUENCE CASCADE +
        // CREATE SEQUENCE + ALTER SEQUENCE OWNED BY + restore the
        // column default. That path silently reset `last_value` to the
        // START WITH value (data-loss bug) and produced a CycleError
        // when the owning column's table survived. The diff now emits
        // a single ALTER SEQUENCE ... AS bigint, which preserves the
        // sequence's last_value, OWNED BY relationship, and the
        // column's DEFAULT reference automatically.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.user_id_seq AS integer;
          CREATE TABLE test_schema.users (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq'::regclass)
          );
          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
          testSql: `
          ALTER SEQUENCE test_schema.user_id_seq AS bigint;
        `,
          expectedSqlTerms: [
            // `AS bigint` widens the implicit MAXVALUE from integer's
            // 2^31-1 to bigint's 2^63-1; the diff emits `NO MAXVALUE`
            // because the new bound equals bigint's default.
            "ALTER SEQUENCE test_schema.user_id_seq AS bigint NO MAXVALUE",
          ],
        });
      }),
    );

    test(
      "create table with GENERATED ALWAYS AS IDENTITY column",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.identity_always (
            id int GENERATED ALWAYS AS IDENTITY,
            name text
          );
        `,
        });
      }),
    );

    test(
      "create table with GENERATED BY DEFAULT AS IDENTITY column",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.identity_by_default (
            id int GENERATED BY DEFAULT AS IDENTITY,
            name text
          );
        `,
        });
      }),
    );

    test(
      "serial and identity transition diffs",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;

          CREATE TABLE test_schema.items (
            c1 int NOT NULL,
            c2 serial,
            c3 int GENERATED ALWAYS AS IDENTITY
          );
        `,
          testSql: `
          CREATE SEQUENCE test_schema.items_c1_seq OWNED BY test_schema.items.c1;
          ALTER TABLE test_schema.items ALTER COLUMN c1 SET DEFAULT nextval('test_schema.items_c1_seq'::regclass);
          ALTER TABLE test_schema.items ALTER COLUMN c2 DROP DEFAULT;
          DROP SEQUENCE test_schema.items_c2_seq;
          ALTER TABLE test_schema.items ALTER COLUMN c2 ADD GENERATED ALWAYS AS IDENTITY;
          ALTER TABLE test_schema.items ALTER COLUMN c3 SET GENERATED BY DEFAULT;
        `,
          expectedSqlTerms: [
            "DROP SEQUENCE test_schema.items_c2_seq CASCADE",
            "CREATE SEQUENCE test_schema.items_c1_seq",
            "ALTER SEQUENCE test_schema.items_c1_seq OWNED BY test_schema.items.c1",
            "ALTER TABLE test_schema.items ALTER COLUMN c1 SET DEFAULT nextval('test_schema.items_c1_seq'::regclass)",
            "ALTER TABLE test_schema.items ALTER COLUMN c2 DROP DEFAULT",
            "ALTER TABLE test_schema.items ALTER COLUMN c2 ADD GENERATED ALWAYS AS IDENTITY",
            "ALTER TABLE test_schema.items ALTER COLUMN c3 SET GENERATED BY DEFAULT",
          ],
        });
      }),
    );

    test(
      "alter sequence data_type emits ALTER ... AS, not DROP+CREATE",
      withDb(pgVersion, async (db) => {
        // Sequence whose only diff is `data_type: integer → bigint` must
        // be altered in place, not replaced. The previous Drop+Create
        // path silently reset `last_value` to the START WITH value
        // (data-loss bug; see Sentry SUPABASE-API-7RS) and produced a
        // DropSequence ↔ DropTable cycle when a surviving column had
        // DEFAULT nextval(seq).
        await db.main.query("CREATE SEQUENCE public.shrink_seq AS integer");
        await db.branch.query("CREATE SEQUENCE public.shrink_seq AS bigint");

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected plan result");
        const sql = result.plan.statements.join("\n");
        expect(sql).toContain("ALTER SEQUENCE public.shrink_seq AS bigint");
        expect(sql).not.toContain("DROP SEQUENCE");
      }),
    );

    test(
      "shrink sequence type with last_value over new range generates plan that PG rejects at apply",
      withDb(pgVersion, async (db) => {
        // Pin the row-3 behavior from the data_type fix design matrix:
        // shrinking from bigint to integer when last_value exceeds
        // 2^31-1 must produce a plan (no CycleError, no Drop+Create
        // path), and PG must refuse the migration at apply time
        // because `last_value` is out of range. This is the desired
        // behavior — a clear apply-time failure beats the previous
        // silent data corruption (Drop+Create reset last_value to 1
        // and the next nextval would collide with existing rows).
        await db.main.query(
          [
            "CREATE SEQUENCE public.shrink_seq AS bigint",
            // Push last_value above integer's max (2^31 - 1 = 2147483647).
            "SELECT setval('public.shrink_seq', 3000000000)",
          ].join(";\n"),
        );
        await db.branch.query(
          "CREATE SEQUENCE public.shrink_seq AS integer MAXVALUE 2147483647",
        );

        // Plan generation must succeed — no CycleError, no fallback
        // to Drop+Create.
        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected plan result");
        const sql = result.plan.statements.join("\n");
        expect(sql).toContain("ALTER SEQUENCE public.shrink_seq AS integer");
        expect(sql).not.toContain("DROP SEQUENCE");

        // Applying the plan against main must fail because the
        // sequence's existing last_value (3_000_000_000) overflows the
        // new integer range. Run each statement directly so the
        // expected PG error surfaces (applyPlan would also fail; this
        // form is just clearer about what we're asserting).
        let applyError: unknown;
        try {
          for (const statement of result.plan.statements) {
            await db.main.query(statement);
          }
        } catch (err) {
          applyError = err;
        }
        expect(applyError).toBeInstanceOf(Error);
        // PG reports the overflow with one of these phrasings depending
        // on which clause it evaluates first ("AS integer" narrowing the
        // implicit MAXVALUE, or an explicit MAXVALUE / RESTART). Any of
        // them is the correct user-facing failure.
        expect(String(applyError)).toMatch(
          /out of range|maximum value|cannot be greater than MAXVALUE/i,
        );
      }),
    );

    test(
      "identity to serial transition diffs",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.identity_to_serial (
            id int GENERATED ALWAYS AS IDENTITY
          );
        `,
          testSql: `
          ALTER TABLE test_schema.identity_to_serial ALTER COLUMN id DROP IDENTITY;
          CREATE SEQUENCE test_schema.identity_to_serial_id_serial_seq OWNED BY test_schema.identity_to_serial.id;
          ALTER TABLE test_schema.identity_to_serial ALTER COLUMN id SET DEFAULT nextval('test_schema.identity_to_serial_id_serial_seq'::regclass);
        `,
          expectedSqlTerms: [
            "CREATE SEQUENCE test_schema.identity_to_serial_id_serial_seq",
            "ALTER SEQUENCE test_schema.identity_to_serial_id_serial_seq OWNED BY test_schema.identity_to_serial.id",
            "ALTER TABLE test_schema.identity_to_serial ALTER COLUMN id DROP IDENTITY",
            "ALTER TABLE test_schema.identity_to_serial ALTER COLUMN id SET DEFAULT nextval('test_schema.identity_to_serial_id_serial_seq'::regclass)",
          ],
        });
      }),
    );
  });
}
