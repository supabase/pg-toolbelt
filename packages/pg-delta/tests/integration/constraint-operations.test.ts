/**
 * Integration tests for PostgreSQL constraint operations.
 */

import { describe, expect, test } from "bun:test";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  // TODO: Fix constraint dependency detection issues - many complex dependencies
  describe(`constraint operations (pg${pgVersion})`, () => {
    test(
      "add primary key constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
        `,
        });
      }),
    );

    test(
      "add unique constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email);
        `,
        });
      }),
    );

    test(
      "add check constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.products ADD CONSTRAINT products_price_check CHECK (price > 0);
        `,
        });
      }),
    );

    test(
      "add CHECK (FALSE) NO INHERIT constraint on inheritance parent",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          CREATE TABLE test_schema.parent_base (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            CONSTRAINT no_direct_insert CHECK (FALSE) NO INHERIT
          );
        `,
          assertSqlStatements: (sqlStatements) => {
            expect(
              sqlStatements.some((stmt) =>
                stmt.includes(
                  "ADD CONSTRAINT no_direct_insert CHECK (false) NO INHERIT",
                ),
              ),
            ).toBe(true);
          },
        });
      }),
    );

    test(
      "add CHECK (FALSE) NO INHERIT on parent with INHERITS child",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
        `,
          testSql: `
          CREATE TABLE test_schema.parent_base (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            CONSTRAINT no_direct_insert CHECK (FALSE) NO INHERIT
          );

          CREATE TABLE test_schema.child (
            CONSTRAINT child_pkey PRIMARY KEY (id)
          ) INHERITS (test_schema.parent_base);
        `,
          assertSqlStatements: (sqlStatements) => {
            expect(
              sqlStatements.some((stmt) =>
                stmt.includes(
                  "ADD CONSTRAINT no_direct_insert CHECK (false) NO INHERIT",
                ),
              ),
            ).toBe(true);
            expect(
              sqlStatements.some((stmt) =>
                stmt.includes("INHERITS (test_schema.parent_base)"),
              ),
            ).toBe(true);
          },
        });
      }),
    );

    test(
      "drop primary key constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users DROP CONSTRAINT users_pkey;
        `,
        });
      }),
    );

    test(
      "add foreign key constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
          CREATE TABLE test_schema.orders (
            id integer NOT NULL,
            user_id integer NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.orders ADD CONSTRAINT orders_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES test_schema.users (id) ON DELETE CASCADE;
        `,
        });
      }),
    );

    test(
      "modify composite foreign key preserves referenced column order",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.parent (
            x int NOT NULL,
            y int NOT NULL,
            UNIQUE (y, x)
          );
          CREATE TABLE test_schema.child (
            b int NOT NULL,
            a int NOT NULL,
            CONSTRAINT fk_child_parent
              FOREIGN KEY (b, a) REFERENCES test_schema.parent (y, x)
          );
        `,
          testSql: `
          ALTER TABLE test_schema.child DROP CONSTRAINT fk_child_parent;
          ALTER TABLE test_schema.child
            ADD CONSTRAINT fk_child_parent
            FOREIGN KEY (b, a) REFERENCES test_schema.parent (y, x)
            ON DELETE CASCADE;
        `,
        });
      }),
    );

    test(
      "drop unique constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_email_key UNIQUE (email)
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users DROP CONSTRAINT users_email_key;
        `,
        });
      }),
    );

    test(
      "drop check constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL,
            CONSTRAINT products_price_check CHECK (price > 0)
          );
        `,
          testSql: `
          ALTER TABLE test_schema.products DROP CONSTRAINT products_price_check;
        `,
        });
      }),
    );

    test(
      "drop foreign key constraint",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
          CREATE TABLE test_schema.orders (
            id integer NOT NULL,
            user_id integer NOT NULL,
            CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES test_schema.users (id)
          );
        `,
          testSql: `
          ALTER TABLE test_schema.orders DROP CONSTRAINT orders_user_id_fkey;
        `,
        });
      }),
    );

    test(
      "add multiple constraints to same table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            age integer
          );
        `,
          testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
          ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email);
          ALTER TABLE test_schema.users ADD CONSTRAINT users_age_check CHECK (age >= 0);
        `,
        });
      }),
    );

    test(
      "constraint with special characters in names",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA "my-schema";
          CREATE TABLE "my-schema"."my-table" (
            id integer NOT NULL,
            "my-field" text
          );
        `,
          testSql: `
          ALTER TABLE "my-schema"."my-table" ADD CONSTRAINT "my-table_check$constraint"
            CHECK ("my-field" IS NOT NULL);
        `,
        });
      }),
    );

    test(
      "constraint comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.events (
            id integer PRIMARY KEY,
            created_at timestamp
          );
          ALTER TABLE test_schema.events ADD CONSTRAINT events_created_at_not_null CHECK (created_at IS NOT NULL);
        `,
          testSql: `
          COMMENT ON CONSTRAINT events_created_at_not_null ON test_schema.events IS 'created_at must be set';
        `,
        });
      }),
    );

    test(
      "add exclude constraint",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE EXTENSION IF NOT EXISTS btree_gist;
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.reservations (
            id integer PRIMARY KEY,
            room_id integer NOT NULL,
            during tstzrange NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.reservations
            ADD CONSTRAINT no_overlap
            EXCLUDE USING gist (room_id WITH =, during WITH &&);
        `,
          expectedSqlTerms: [
            "ALTER TABLE test_schema.reservations ADD CONSTRAINT no_overlap EXCLUDE USING gist (room_id WITH =, during WITH &&)",
          ],
        });
      }),
      120_000,
    );

    test(
      "extract exclude constraint defined over an expression",
      withDbIsolated(pgVersion, async (db) => {
        // Regression: an EXCLUDE constraint whose key is an expression stores
        // attnum=0 in pg_constraint.conkey, which never matches pg_attribute.
        // The previous extractor's inner json_agg returned SQL NULL in that
        // case, which tripped tablePropsSchema with "expected array, received
        // null" at constraints[*].key_columns. Roundtrip must succeed.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE EXTENSION IF NOT EXISTS btree_gist;
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.expr_excl (
            a integer NOT NULL
          );
        `,
          testSql: `
          ALTER TABLE test_schema.expr_excl
            ADD CONSTRAINT expr_excl_check
            EXCLUDE USING gist ((a + 0) WITH =);
        `,
        });
      }),
      120_000,
    );

    if (pgVersion === 18) {
      test(
        "convert primary key to temporal primary key",
        withDbIsolated(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            CREATE EXTENSION IF NOT EXISTS btree_gist;
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.bookings (
              room_id integer NOT NULL,
              booking_period tstzrange NOT NULL,
              CONSTRAINT bookings_pkey PRIMARY KEY (room_id, booking_period)
            );
          `,
            testSql: `
            ALTER TABLE test_schema.bookings DROP CONSTRAINT bookings_pkey;
            ALTER TABLE test_schema.bookings
              ADD CONSTRAINT bookings_pkey
              PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS);
          `,
          });
        }),
        120_000,
      );

      test(
        "add temporal foreign key constraint",
        withDbIsolated(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            CREATE EXTENSION IF NOT EXISTS btree_gist;
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.bookings (
              room_id integer NOT NULL,
              booking_period tstzrange NOT NULL,
              CONSTRAINT bookings_pkey PRIMARY KEY (room_id, booking_period WITHOUT OVERLAPS)
            );
            CREATE TABLE test_schema.booking_audit (
              room_id integer NOT NULL,
              booking_period tstzrange NOT NULL
            );
          `,
            testSql: `
            ALTER TABLE test_schema.booking_audit
              ADD CONSTRAINT booking_audit_room_id_booking_period_fkey
              FOREIGN KEY (room_id, PERIOD booking_period)
              REFERENCES test_schema.bookings (room_id, PERIOD booking_period);
          `,
          });
        }),
        120_000,
      );

      // Silent-downgrade scenario from #182: two related tables whose
      // non-temporal PK + FK are dropped and re-added together to introduce
      // WITHOUT OVERLAPS on the PK and PERIOD on the FK columns.
      test(
        "convert related PK and FK to temporal together",
        withDbIsolated(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            CREATE EXTENSION IF NOT EXISTS btree_gist;
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.contacts (
              contact_id integer NOT NULL,
              valid_period tstzrange NOT NULL,
              CONSTRAINT contacts_pkey PRIMARY KEY (contact_id, valid_period)
            );
            CREATE TABLE test_schema.conversations (
              conversation_id integer NOT NULL,
              contact_id integer NOT NULL,
              valid_period tstzrange NOT NULL,
              CONSTRAINT conversations_pkey PRIMARY KEY (conversation_id),
              CONSTRAINT conversations_contact_fkey
                FOREIGN KEY (contact_id, valid_period)
                REFERENCES test_schema.contacts (contact_id, valid_period)
            );
          `,
            testSql: `
            ALTER TABLE test_schema.conversations DROP CONSTRAINT conversations_contact_fkey;
            ALTER TABLE test_schema.contacts DROP CONSTRAINT contacts_pkey;
            ALTER TABLE test_schema.contacts
              ADD CONSTRAINT contacts_pkey
              PRIMARY KEY (contact_id, valid_period WITHOUT OVERLAPS);
            ALTER TABLE test_schema.conversations
              ADD CONSTRAINT conversations_contact_fkey
              FOREIGN KEY (contact_id, PERIOD valid_period)
              REFERENCES test_schema.contacts (contact_id, PERIOD valid_period);
          `,
          });
        }),
        120_000,
      );
    }
  });
}
