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
