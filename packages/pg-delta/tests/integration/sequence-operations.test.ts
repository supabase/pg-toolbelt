/**
 * Integration tests for PostgreSQL sequence operations.
 */

import { describe, test } from "bun:test";
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
            "ALTER TABLE test_schema.items ALTER COLUMN c3 SET GENERATED BY DEFAULT",
            "ALTER TABLE test_schema.items ALTER COLUMN c2 DROP DEFAULT",
            "ALTER TABLE test_schema.items ALTER COLUMN c2 ADD GENERATED ALWAYS AS IDENTITY",
          ],
        });
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
