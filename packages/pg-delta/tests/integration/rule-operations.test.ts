import { describe, test } from "bun:test";
import dedent from "dedent";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`rule operations (pg${pgVersion})`, () => {
    test(
      "create rule",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
        `,
          testSql: dedent`
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
        });
      }),
    );

    test(
      "drop rule",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
          testSql: `DROP RULE prevent_negative_balance ON test_schema.accounts;`,
        });
      }),
    );

    test(
      "replace rule definition",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE TABLE test_schema.rule_events (
            message text NOT NULL,
            created_at timestamptz DEFAULT now()
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
          testSql: dedent`
          CREATE OR REPLACE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO ALSO INSERT INTO test_schema.rule_events (message)
              VALUES ('negative balance attempt detected');
        `,
        });
      }),
    );

    test(
      "rule comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
          testSql: `COMMENT ON RULE prevent_negative_balance ON test_schema.accounts IS 'prevent inserting negative balances';`,
        });
      }),
    );

    test(
      "rule enabled state",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
        `,
          testSql: `ALTER TABLE test_schema.accounts DISABLE RULE prevent_negative_balance;`,
        });
      }),
    );

    test(
      "rule enable always state",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            balance numeric NOT NULL DEFAULT 0
          );
          CREATE RULE prevent_negative_balance AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.balance < 0
            DO INSTEAD NOTHING;
          ALTER TABLE test_schema.accounts DISABLE RULE prevent_negative_balance;
        `,
          testSql: `ALTER TABLE test_schema.accounts ENABLE ALWAYS RULE prevent_negative_balance;`,
        });
      }),
    );

    test(
      "rule creation depends on newly added column",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.accounts (
            id serial PRIMARY KEY,
            note text
          );
        `,
          testSql: dedent`
          ALTER TABLE test_schema.accounts
            ADD COLUMN flagged boolean;

          CREATE RULE prevent_flagged_insert AS
            ON INSERT TO test_schema.accounts
            WHERE NEW.flagged
            DO INSTEAD NOTHING;
        `,
          sortChangesCallback: (a, b) => {
            // force create rule before alter table to test that we track the dependency rule -> column
            const priority = (change: Change) => {
              if (
                change.objectType === "rule" &&
                change.operation === "create"
              ) {
                return 0;
              }
              if (
                change.objectType === "table" &&
                change.operation === "alter"
              ) {
                return 1;
              }
              return 2;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );

    test(
      "rule depending on rewritten column is recreated around ALTER COLUMN TYPE",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.accounts (
              id integer PRIMARY KEY,
              status text NOT NULL
            );

            CREATE RULE block_blocked_accounts AS
              ON INSERT TO test_schema.accounts
              WHERE NEW.status = 'blocked'
              DO INSTEAD NOTHING;
          `,
          testSql: dedent`
            CREATE TYPE test_schema.account_status AS ENUM ('active', 'blocked');

            DROP RULE block_blocked_accounts ON test_schema.accounts;

            ALTER TABLE test_schema.accounts
              ALTER COLUMN status TYPE test_schema.account_status
              USING status::test_schema.account_status;

            CREATE RULE block_blocked_accounts AS
              ON INSERT TO test_schema.accounts
              WHERE NEW.status = 'blocked'::test_schema.account_status
              DO INSTEAD NOTHING;
          `,
        });
      }),
    );

    test(
      "rule depending on replaced function signature is recreated around the function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.is_valid_amount(value integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $$ SELECT value > 0 $$;

            CREATE TABLE test_schema.items (
              id integer PRIMARY KEY,
              amount integer NOT NULL
            );

            CREATE RULE block_invalid_amount AS
              ON INSERT TO test_schema.items
              WHERE NOT test_schema.is_valid_amount(NEW.amount)
              DO INSTEAD NOTHING;
          `,
          testSql: dedent`
            DROP RULE block_invalid_amount ON test_schema.items;
            DROP FUNCTION test_schema.is_valid_amount(integer);

            CREATE FUNCTION test_schema.is_valid_amount(value bigint)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $$ SELECT value > 0 $$;

            CREATE RULE block_invalid_amount AS
              ON INSERT TO test_schema.items
              WHERE NOT test_schema.is_valid_amount(NEW.amount::bigint)
              DO INSTEAD NOTHING;
          `,
        });
      }),
    );
  });
}
