/**
 * Integration tests for PostgreSQL sequence operations.
 */

import { describe, expect, test } from "bun:test";
import { applyPlan } from "../../src/core/plan/apply.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";
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
      "sequence owner restores run after detach and privilege replay",
      withDb(pgVersion, async (db) => {
        const initialSetup = `
          CREATE SCHEMA test_schema;
          DO $$
          BEGIN
            CREATE ROLE seq_review_old_owner;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END
          $$;
          DO $$
          BEGIN
            CREATE ROLE seq_review_new_owner;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END
          $$;
          DO $$
          BEGIN
            CREATE ROLE seq_review_reader;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END
          $$;

          CREATE SEQUENCE test_schema.existing_owned_seq;
          CREATE TABLE test_schema.old_items (
            id bigint DEFAULT nextval('test_schema.existing_owned_seq'::regclass)
          );
          ALTER SEQUENCE test_schema.existing_owned_seq OWNED BY test_schema.old_items.id;
          ALTER TABLE test_schema.old_items OWNER TO seq_review_old_owner;
        `;
        const testSql = `
          ALTER SEQUENCE test_schema.existing_owned_seq OWNED BY NONE;
          ALTER SEQUENCE test_schema.existing_owned_seq OWNER TO seq_review_new_owner;

          CREATE SEQUENCE test_schema.acl_seq;
          GRANT USAGE ON SEQUENCE test_schema.acl_seq TO seq_review_reader;
          ALTER SEQUENCE test_schema.acl_seq OWNER TO seq_review_new_owner;
        `;

        await db.main.query(initialSetup);
        await db.branch.query(initialSetup);
        await db.branch.query(testSql);

        const planResult = await createPlan(db.main, db.branch);
        expect(planResult).not.toBeNull();
        if (!planResult) return;

        const sqlStatements = flattenPlanStatements(planResult.plan);
        const existingDetachIndex = sqlStatements.indexOf(
          "ALTER SEQUENCE test_schema.existing_owned_seq OWNED BY NONE",
        );
        const existingOwnerIndex = sqlStatements.indexOf(
          "ALTER SEQUENCE test_schema.existing_owned_seq OWNER TO seq_review_new_owner",
        );
        const createdGrantIndex = sqlStatements.indexOf(
          "GRANT USAGE ON SEQUENCE test_schema.acl_seq TO seq_review_reader",
        );
        const createdOwnerIndex = sqlStatements.indexOf(
          "ALTER SEQUENCE test_schema.acl_seq OWNER TO seq_review_new_owner",
        );

        expect(existingDetachIndex).toBeGreaterThan(-1);
        expect(existingOwnerIndex).toBeGreaterThan(existingDetachIndex);
        expect(createdGrantIndex).toBeGreaterThan(-1);
        expect(createdOwnerIndex).toBeGreaterThan(createdGrantIndex);

        const applyResult = await applyPlan(
          planResult.plan,
          db.main,
          db.branch,
          {
            verifyPostApply: false,
          },
        );
        expect(applyResult.status).toBe("applied");

        const { rows } = await db.main.query<{
          existing_owner: string;
          acl_owner: string;
          reader_has_usage: boolean;
        }>(`
          SELECT
            pg_get_userbyid(existing.relowner) AS existing_owner,
            pg_get_userbyid(acl.relowner) AS acl_owner,
            has_sequence_privilege(
              'seq_review_reader',
              'test_schema.acl_seq',
              'USAGE'
            ) AS reader_has_usage
          FROM pg_class existing
          CROSS JOIN pg_class acl
          JOIN pg_namespace existing_ns ON existing_ns.oid = existing.relnamespace
          JOIN pg_namespace acl_ns ON acl_ns.oid = acl.relnamespace
          WHERE existing_ns.nspname = 'test_schema'
            AND existing.relname = 'existing_owned_seq'
            AND acl_ns.nspname = 'test_schema'
            AND acl.relname = 'acl_seq';
        `);
        expect(rows[0]).toEqual({
          existing_owner: "seq_review_new_owner",
          acl_owner: "seq_review_new_owner",
          reader_has_usage: true,
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
      "drop sequence referenced by column default",
      withDb(pgVersion, async (db) => {
        // Regression for https://github.com/supabase/pg-toolbelt/issues/230
        // The column default `nextval('test_schema.my_seq'::regclass)` keeps a
        // pg_depend edge from the column to the sequence. Dropping the
        // sequence requires the default to be removed first; otherwise
        // PostgreSQL aborts the migration with error 2BP01.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE SEQUENCE test_schema.my_seq START 1000;
          CREATE TABLE test_schema.items (
            id integer PRIMARY KEY DEFAULT nextval('test_schema.my_seq'::regclass),
            name text
          );
        `,
          testSql: `
          ALTER TABLE test_schema.items ALTER COLUMN id DROP DEFAULT;
          DROP SEQUENCE test_schema.my_seq;
        `,
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
            // DROP DEFAULT is routed to the drop phase so it releases the
            // pg_depend edge to items_c2_seq before the sequence drop runs.
            "ALTER TABLE test_schema.items ALTER COLUMN c2 DROP DEFAULT",
            "DROP SEQUENCE test_schema.items_c2_seq CASCADE",
            "CREATE SEQUENCE test_schema.items_c1_seq",
            "ALTER SEQUENCE test_schema.items_c1_seq OWNED BY test_schema.items.c1",
            "ALTER TABLE test_schema.items ALTER COLUMN c1 SET DEFAULT nextval('test_schema.items_c1_seq'::regclass)",
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
        const sql = flattenPlanStatements(result.plan).join("\n");
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
        const sql = flattenPlanStatements(result.plan).join("\n");
        expect(sql).toContain("ALTER SEQUENCE public.shrink_seq AS integer");
        expect(sql).not.toContain("DROP SEQUENCE");

        // Applying the plan against main must fail because the
        // sequence's existing last_value (3_000_000_000) overflows the
        // new integer range. Run each statement directly so the
        // expected PG error surfaces (applyPlan would also fail; this
        // form is just clearer about what we're asserting).
        let applyError: unknown;
        try {
          for (const statement of flattenPlanStatements(result.plan)) {
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
            // DROP IDENTITY is routed to the drop phase so it tears down
            // the implicit identity sequence before the new sequence and
            // matching default are introduced.
            "ALTER TABLE test_schema.identity_to_serial ALTER COLUMN id DROP IDENTITY",
            "CREATE SEQUENCE test_schema.identity_to_serial_id_serial_seq",
            "ALTER SEQUENCE test_schema.identity_to_serial_id_serial_seq OWNED BY test_schema.identity_to_serial.id",
            "ALTER TABLE test_schema.identity_to_serial ALTER COLUMN id SET DEFAULT nextval('test_schema.identity_to_serial_id_serial_seq'::regclass)",
          ],
        });
      }),
    );
  });
}
