/**
 * Integration tests for PostgreSQL table operations.
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`table operations (pg${pgVersion})`, () => {
    test(
      "simple table with columns",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.users (
            id integer,
            name text NOT NULL,
            email text
          );
        `,
        });
      }),
    );

    test(
      "table with constraints",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.constrained_table (
            id integer,
            name text NOT NULL,
            email text,
            age integer
          );
        `,
        });
      }),
    );

    test(
      "multiple tables",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.users (
            id integer,
            name text NOT NULL
          );

          CREATE TABLE test_schema.posts (
            id integer,
            title text NOT NULL,
            content text
          );
        `,
        });
      }),
    );

    test(
      "table with various types",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.type_test (
            col_int integer,
            col_bigint bigint,
            col_text text,
            col_varchar varchar(50),
            col_boolean boolean,
            col_timestamp timestamp,
            col_numeric numeric(10,2),
            col_uuid uuid
          );
        `,
        });
      }),
    );

    test(
      "table in public schema",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "",
          testSql: `
          CREATE TABLE public.simple_table (
            id integer,
            name text
          );
        `,
        });
      }),
    );

    test(
      "empty table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE TABLE test_schema.empty_table ();
        `,
        });
      }),
    );

    test(
      "tables in multiple schemas",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA schema_a;
          CREATE SCHEMA schema_b;
        `,
          testSql: `
          CREATE TABLE schema_a.table_a (
            id integer,
            name text
          );

          CREATE TABLE schema_b.table_b (
            id integer,
            description text
          );
        `,
        });
      }),
    );

    test(
      "partitioned table RANGE",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `CREATE SCHEMA test_schema;`,
          testSql: `
          CREATE TABLE test_schema.events (
            created_at timestamp without time zone NOT NULL,
            payload text
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2024 PARTITION OF test_schema.events
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

          CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        });
      }),
    );

    test(
      "attach partition",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            created_at timestamp without time zone NOT NULL,
            payload text
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2025 (
            created_at timestamp without time zone NOT NULL,
            payload text
          );
        `,
          testSql: `
          ALTER TABLE test_schema.events
          ATTACH PARTITION test_schema.events_2025
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
        });
      }),
    );

    test(
      "detach partition",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            created_at timestamp without time zone NOT NULL,
            payload text
          ) PARTITION BY RANGE (created_at);

          CREATE TABLE test_schema.events_2025 PARTITION OF test_schema.events
          FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
        `,
          testSql: `
          ALTER TABLE test_schema.events
          DETACH PARTITION test_schema.events_2025;
        `,
        });
      }),
    );

    test(
      "table comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            id integer,
            created_at timestamp without time zone NOT NULL,
            payload text
          );
        `,
          testSql: `
          ALTER TABLE test_schema.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
          ALTER TABLE test_schema.events ADD COLUMN description text;
          COMMENT ON TABLE test_schema.events IS 'This is a test table';
          COMMENT ON COLUMN test_schema.events.created_at IS 'This is a created_at column';
          COMMENT ON CONSTRAINT events_pkey ON test_schema.events IS 'This is a test constraint';
          COMMENT ON COLUMN test_schema.events.description IS 'This is a description column';
        `,
        });
      }),
    );

    test.skipIf(pgVersion < 17)(
      "postgres 17 generated column type change rebuilds constrained columns",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA generated_pg17;
            CREATE TABLE generated_pg17.accounts (
              status text NOT NULL,
              status_label text GENERATED ALWAYS AS (upper(status)) STORED NOT NULL,
              CONSTRAINT accounts_status_label_check CHECK (status_label <> '')
            );
          `,
          testSql: dedent`
            ALTER TABLE generated_pg17.accounts DROP CONSTRAINT accounts_status_label_check;
            ALTER TABLE generated_pg17.accounts DROP COLUMN status_label;
            ALTER TABLE generated_pg17.accounts
              ADD COLUMN status_label varchar(64) GENERATED ALWAYS AS (upper(status)) STORED NOT NULL;
            ALTER TABLE generated_pg17.accounts
              ADD CONSTRAINT accounts_status_label_check CHECK (status_label <> '');
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toContain(
              "ALTER TABLE generated_pg17.accounts DROP COLUMN status_label",
            );
            expect(statements).toContain(
              "ALTER TABLE generated_pg17.accounts ADD COLUMN status_label character varying(64) GENERATED ALWAYS AS (upper(status)) STORED NOT NULL",
            );
            expect(
              statements.some((statement) =>
                statement.startsWith(
                  "ALTER TABLE generated_pg17.accounts ADD CONSTRAINT accounts_status_label_check CHECK",
                ),
              ),
            ).toBe(true);
            expect(
              statements.some((statement) =>
                statement.includes("ALTER COLUMN status_label DROP DEFAULT"),
              ),
            ).toBe(false);
            expect(
              statements.some((statement) =>
                statement.includes("ALTER COLUMN status_label TYPE"),
              ),
            ).toBe(false);
          },
        });
      }),
    );

    test.skipIf(pgVersion < 17)(
      "postgres 17 generated column dependency rebuild removes superseded type alters",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA generated_dep_pg17;
            CREATE TABLE generated_dep_pg17.accounts (
              status text NOT NULL,
              status_label text GENERATED ALWAYS AS (upper(status)) STORED NOT NULL
            );
          `,
          testSql: dedent`
            ALTER TABLE generated_dep_pg17.accounts DROP COLUMN status_label;
            ALTER TABLE generated_dep_pg17.accounts
              ALTER COLUMN status TYPE varchar(32) USING status::varchar(32);
            ALTER TABLE generated_dep_pg17.accounts
              ADD COLUMN status_label varchar(64) GENERATED ALWAYS AS (upper(status)) STORED NOT NULL;
          `,
          assertSqlStatements: (statements) => {
            expect(statements).toContain(
              "ALTER TABLE generated_dep_pg17.accounts DROP COLUMN status_label",
            );
            expect(
              statements.some((statement) =>
                statement.startsWith(
                  "ALTER TABLE generated_dep_pg17.accounts ADD COLUMN status_label character varying(64) GENERATED ALWAYS AS",
                ),
              ),
            ).toBe(true);
            expect(
              statements.some((statement) =>
                statement.includes("STORED NOT NULL"),
              ),
            ).toBe(true);
            expect(
              statements.some((statement) =>
                statement.includes("upper((status)::text)"),
              ),
            ).toBe(true);
            expect(
              statements.some((statement) =>
                statement.includes("ALTER COLUMN status_label TYPE"),
              ),
            ).toBe(false);
          },
        });
      }),
    );

    test(
      "rebuilds FK-backed standalone indexes by replacing dependent foreign keys",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA fk_index_regression;
            CREATE TABLE fk_index_regression.accounts (
              status text NOT NULL
            );
            CREATE UNIQUE INDEX accounts_status_key_idx
              ON fk_index_regression.accounts (status);
            CREATE TABLE fk_index_regression.account_events (
              status text NOT NULL
            );
            ALTER TABLE fk_index_regression.account_events
              ADD CONSTRAINT account_events_status_fkey
              FOREIGN KEY (status) REFERENCES fk_index_regression.accounts(status)
              NOT VALID;
            COMMENT ON CONSTRAINT account_events_status_fkey
              ON fk_index_regression.account_events
              IS 'account status reference';
          `,
          testSql: dedent`
            ALTER TABLE fk_index_regression.account_events
              DROP CONSTRAINT account_events_status_fkey;
            ALTER TABLE fk_index_regression.accounts
              ALTER COLUMN status TYPE varchar(32) USING status::varchar(32);
            DROP INDEX fk_index_regression.accounts_status_key_idx;
            CREATE UNIQUE INDEX accounts_status_key_idx
              ON fk_index_regression.accounts (status);
            ALTER TABLE fk_index_regression.account_events
              ADD CONSTRAINT account_events_status_fkey
              FOREIGN KEY (status) REFERENCES fk_index_regression.accounts(status)
              NOT VALID;
            COMMENT ON CONSTRAINT account_events_status_fkey
              ON fk_index_regression.account_events
              IS 'account status reference';
          `,
          assertSqlStatements: (statements) => {
            const dropConstraintIdx = statements.findIndex((statement) =>
              statement.includes(
                "ALTER TABLE fk_index_regression.account_events DROP CONSTRAINT account_events_status_fkey",
              ),
            );
            const dropIndexIdx = statements.findIndex((statement) =>
              statement.includes(
                "DROP INDEX fk_index_regression.accounts_status_key_idx",
              ),
            );
            const createIndexIdx = statements.findIndex((statement) =>
              statement.includes("CREATE UNIQUE INDEX accounts_status_key_idx"),
            );
            const addConstraintIdx = statements.findIndex((statement) =>
              statement.includes(
                "ALTER TABLE fk_index_regression.account_events ADD CONSTRAINT account_events_status_fkey",
              ),
            );
            const commentConstraintIdx = statements.findIndex((statement) =>
              statement.includes(
                "COMMENT ON CONSTRAINT account_events_status_fkey ON fk_index_regression.account_events",
              ),
            );

            expect(dropConstraintIdx).toBeGreaterThanOrEqual(0);
            expect(dropIndexIdx).toBeGreaterThanOrEqual(0);
            expect(createIndexIdx).toBeGreaterThanOrEqual(0);
            expect(addConstraintIdx).toBeGreaterThanOrEqual(0);
            expect(commentConstraintIdx).toBeGreaterThanOrEqual(0);
            expect(statements[addConstraintIdx]).toContain("NOT VALID");
            expect(dropConstraintIdx).toBeLessThan(dropIndexIdx);
            expect(createIndexIdx).toBeLessThan(addConstraintIdx);
            expect(addConstraintIdx).toBeLessThan(commentConstraintIdx);
          },
        });
      }),
    );

    test(
      "replace table via enum dependency does not emit standalone drop/create for PK-owned index",
      withDb(pgVersion, async (db) => {
        // Regression guard for the index arm in expandReplaceDependencies.
        // When an enum change forces DropCompositeType+CreateCompositeType-style
        // replacement, the expander promotes every table with a column of that
        // enum to a drop+create pair. The dependent PK index must be left to
        // AlterTableAddConstraint inside the CreateTable branch; emitting a
        // standalone DROP INDEX for a constraint-owned index fails with
        // "cannot drop index ... because constraint ... requires it".
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA pk_regression;
            CREATE TYPE pk_regression.status AS ENUM ('draft', 'published', 'archived');
            CREATE TABLE pk_regression.posts (
              id integer PRIMARY KEY,
              title text NOT NULL,
              status pk_regression.status NOT NULL DEFAULT 'draft'
            );
            CREATE VIEW pk_regression.published_posts AS
              SELECT id, title FROM pk_regression.posts
              WHERE status = 'published';
          `,
          testSql: dedent`
            DROP VIEW pk_regression.published_posts;
            ALTER TABLE pk_regression.posts ALTER COLUMN status DROP DEFAULT;
            DROP TABLE pk_regression.posts;
            DROP TYPE pk_regression.status;
            CREATE TYPE pk_regression.status AS ENUM ('draft', 'published');
            CREATE TABLE pk_regression.posts (
              id integer PRIMARY KEY,
              title text NOT NULL,
              status pk_regression.status NOT NULL DEFAULT 'draft'
            );
            CREATE VIEW pk_regression.published_posts AS
              SELECT id, title FROM pk_regression.posts
              WHERE status = 'published';
          `,
          assertSqlStatements: (statements) => {
            for (const stmt of statements) {
              expect(stmt).not.toMatch(
                /^DROP INDEX\s+pk_regression\.posts_pkey\b/i,
              );
              expect(stmt).not.toMatch(
                /^CREATE UNIQUE INDEX\s+posts_pkey\s+ON\s+pk_regression\.posts\b/i,
              );
            }
          },
        });
      }),
    );
  });
}
