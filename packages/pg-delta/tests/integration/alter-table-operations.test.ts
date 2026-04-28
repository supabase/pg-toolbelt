/**
 * Integration tests for PostgreSQL ALTER TABLE operations.
 */

import { describe, test } from "bun:test";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  // TODO: Fix ALTER TABLE operations dependency detection issues
  describe(`alter table operations (pg${pgVersion})`, () => {
    test(
      "add column then create unique index on it",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.idx_users (
            id integer NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.idx_users ADD COLUMN email character varying(255);
          ALTER TABLE test_schema.idx_users ADD CONSTRAINT users_email_key UNIQUE (email);
        `,
          // Force AlterTableAddConstraint to be after AlterTableAddColumn
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "table" &&
                change.operation === "alter"
              ) {
                return change.constructor.name === "AlterTableAddColumn"
                  ? 0
                  : 1;
              }
              return 2;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );
    test(
      "add column to existing table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users ADD COLUMN email character varying(255) NOT NULL DEFAULT 'user@example.com';
        `,
        });
      }),
    );

    test(
      "drop column from existing table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            name text NOT NULL,
            old_field text,
            description text
          );
        `,
          testSql: `
          ALTER TABLE test_schema.products DROP COLUMN old_field;
        `,
        });
      }),
    );

    test(
      "change column type",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.conversions (
            id integer NOT NULL,
            price numeric(8,2),
            status_code smallint
          );
        `,
          testSql: `
          ALTER TABLE test_schema.conversions ALTER COLUMN price TYPE numeric(12,4);
        `,
        });
      }),
    );

    test(
      "set column default",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.settings (
            id integer NOT NULL,
            enabled boolean,
            created_at timestamp
          );
        `,
          testSql: `
          ALTER TABLE test_schema.settings ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        `,
        });
      }),
    );

    test(
      "drop column default",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.configs (
            id integer NOT NULL,
            status text DEFAULT 'pending',
            value text
          );
        `,
          testSql: `
          ALTER TABLE test_schema.configs ALTER COLUMN status DROP DEFAULT;
        `,
        });
      }),
    );

    test(
      "set column not null",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            name text
          );
          INSERT INTO test_schema.users (id, name) VALUES (1, 'Test User');
        `,
          testSql: `
          ALTER TABLE test_schema.users ALTER COLUMN name SET NOT NULL;
        `,
        });
      }),
    );

    test(
      "drop column not null",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.profiles (
            id integer NOT NULL,
            email text NOT NULL,
            phone text
          );
        `,
          testSql: `
          ALTER TABLE test_schema.profiles ALTER COLUMN email DROP NOT NULL;
        `,
        });
      }),
    );

    test(
      "multiple alter operations - state-based diffing",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.evolution (
            id integer NOT NULL,
            old_name varchar(50),
            status text DEFAULT 'pending'
          );
        `,
          testSql: `
          ALTER TABLE test_schema.evolution ADD COLUMN email character varying(255);
          ALTER TABLE test_schema.evolution ALTER COLUMN old_name TYPE text;
          ALTER TABLE test_schema.evolution ALTER COLUMN status DROP DEFAULT;
          ALTER TABLE test_schema.evolution DROP COLUMN status;
        `,
        });
      }),
    );

    test(
      "complex column changes",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.complex_changes (
            id integer NOT NULL,
            email text,
            status varchar(20) DEFAULT 'active',
            created_at timestamp
          );
        `,
          testSql: `
          ALTER TABLE test_schema.complex_changes ALTER COLUMN email TYPE character varying(255);
          ALTER TABLE test_schema.complex_changes ALTER COLUMN email SET NOT NULL;
          ALTER TABLE test_schema.complex_changes ALTER COLUMN email SET DEFAULT 'user@example.com';
          ALTER TABLE test_schema.complex_changes ALTER COLUMN status DROP DEFAULT;
          ALTER TABLE test_schema.complex_changes ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        `,
        });
      }),
    );

    test(
      "generated column operations",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users ADD COLUMN full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
          ALTER TABLE test_schema.users ADD COLUMN email character varying(255) DEFAULT 'user@example.com';
        `,
        });
      }),
    );

    test(
      "drop generated column",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL,
            tax_rate numeric(5,4) DEFAULT 0.0875,
            total_price numeric(10,2) GENERATED ALWAYS AS (price * (1 + tax_rate)) STORED
          );
        `,
          testSql: `
          ALTER TABLE test_schema.products DROP COLUMN total_price;
        `,
        });
      }),
    );

    test(
      "alter generated column expression",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.calculations (
            id integer NOT NULL,
            value_a numeric NOT NULL,
            value_b numeric NOT NULL,
            computed numeric GENERATED ALWAYS AS (value_a + value_b) STORED
          );
        `,
          testSql: `
          ALTER TABLE test_schema.calculations DROP COLUMN computed;
          ALTER TABLE test_schema.calculations ADD COLUMN computed numeric GENERATED ALWAYS AS (value_a * value_b) STORED;
        `,
          // Force ADD COLUMN to be before DROP COLUMN to test that we track the dependency column -> generated column
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "table" &&
                change.operation === "alter"
              ) {
                return change.constructor.name === "AlterTableAddColumn"
                  ? 0
                  : 1;
              }
              return 2;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );

    test(
      "table and column comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            id integer,
            created_at timestamp
          );
        `,
          testSql: `
          COMMENT ON TABLE test_schema.events IS 'events table';
          COMMENT ON COLUMN test_schema.events.created_at IS 'created_at column';
        `,
        });
      }),
    );

    // Regression coverage for CLI-754: widening the type of a column that
    // already has a default on main must preserve the default.
    test(
      "widen column type preserves pre-existing default",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.priced (
            id integer NOT NULL,
            price numeric(8,2) DEFAULT 0.00
          );
          INSERT INTO test_schema.priced (id) VALUES (1);
        `,
          testSql: `
          ALTER TABLE test_schema.priced ALTER COLUMN price TYPE numeric(12,4);
        `,
        });
      }),
    );

    // CLI-754: ENUM → text with default. Currently fails because the plan
    // emits `DROP TYPE test_schema.status` *before* the `ALTER COLUMN TYPE`,
    // so the drop fails on the remaining column dependency. Leave skipped
    // until the dependency ordering between AlterColumnType and the dropped
    // source type is fixed.
    test.skip(
      "change column type from enum to text preserves default",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TYPE test_schema.status AS ENUM ('active', 'inactive');
          CREATE TABLE test_schema.items (
            id integer NOT NULL,
            state test_schema.status DEFAULT 'active'
          );
          INSERT INTO test_schema.items (id) VALUES (1);
        `,
          testSql: `
          ALTER TABLE test_schema.items
            ALTER COLUMN state DROP DEFAULT,
            ALTER COLUMN state TYPE text USING state::text,
            ALTER COLUMN state SET DEFAULT 'active';
          DROP TYPE test_schema.status;
        `,
        });
      }),
    );

    test(
      "set replica identity using index on existing table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.replicated (
            id integer NOT NULL,
            tenant_id integer NOT NULL,
            payload text
          );
          CREATE UNIQUE INDEX replicated_tenant_id_key
            ON test_schema.replicated (tenant_id);
        `,
          testSql: `
          ALTER TABLE test_schema.replicated
            REPLICA IDENTITY USING INDEX replicated_tenant_id_key;
        `,
        });
      }),
    );

    test(
      "create table with replica identity using index",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          CREATE TABLE test_schema.replicated (
            id integer NOT NULL,
            tenant_id integer NOT NULL,
            payload text
          );
          CREATE UNIQUE INDEX replicated_tenant_id_key
            ON test_schema.replicated (tenant_id);
          ALTER TABLE test_schema.replicated
            REPLICA IDENTITY USING INDEX replicated_tenant_id_key;
        `,
        });
      }),
    );
  });
}
