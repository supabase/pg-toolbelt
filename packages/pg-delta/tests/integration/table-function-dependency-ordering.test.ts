/**
 * Integration tests for table-function dependency ordering.
 *
 * These tests specifically verify that the ordering fix works correctly:
 * 1. Functions with RETURNS SETOF need tables to exist first
 * 2. Tables with function-based defaults need functions to exist first (handled by refinement)
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`table-function dependency ordering (pg${pgVersion})`, () => {
    test(
      "verify tables created before functions with RETURNS SETOF",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE TABLE test_schema.users (
            id bigserial PRIMARY KEY,
            email text UNIQUE
          );

          CREATE FUNCTION test_schema.get_users()
          RETURNS SETOF test_schema.users
          LANGUAGE sql
          STABLE
          AS $function$SELECT * FROM test_schema.users$function$;
        `,
        });
      }),
    );

    test(
      "verify function-based defaults work via refinement",
      withDb(pgVersion, async (db) => {
        // This tests the refinement pass which reorders when table depends on function
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.serial_counter()
          RETURNS integer
          LANGUAGE plpgsql
          VOLATILE
          AS $function$
          BEGIN
            RETURN nextval('test_schema.counter_seq'::regclass);
          END;
          $function$;

          CREATE SEQUENCE test_schema.counter_seq;

          CREATE TABLE test_schema.event_log (
            id integer PRIMARY KEY DEFAULT test_schema.serial_counter(),
            message text
          );
        `,
        });
      }),
    );

    test(
      "aggregate depending on invalidated SQL function is rebuilt before the function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA routine_rebuild;
            CREATE TABLE routine_rebuild.accounts (
              id integer PRIMARY KEY,
              status text NOT NULL
            );

            CREATE FUNCTION routine_rebuild.status_len_state(state integer, account_id integer)
            RETURNS integer
            LANGUAGE sql
            STABLE
            BEGIN ATOMIC
              SELECT state + length(status::text)
              FROM routine_rebuild.accounts
              WHERE id = account_id;
            END;

            CREATE AGGREGATE routine_rebuild.status_len_sum(integer) (
              SFUNC = routine_rebuild.status_len_state,
              STYPE = integer,
              INITCOND = '0'
            );
          `,
          testSql: dedent`
            DROP AGGREGATE routine_rebuild.status_len_sum(integer);
            DROP FUNCTION routine_rebuild.status_len_state(integer, integer);
            ALTER TABLE routine_rebuild.accounts
              ALTER COLUMN status TYPE varchar(32);

            CREATE FUNCTION routine_rebuild.status_len_state(state integer, account_id integer)
            RETURNS integer
            LANGUAGE sql
            STABLE
            BEGIN ATOMIC
              SELECT state + length(status::text)
              FROM routine_rebuild.accounts
              WHERE id = account_id;
            END;

            CREATE AGGREGATE routine_rebuild.status_len_sum(integer) (
              SFUNC = routine_rebuild.status_len_state,
              STYPE = integer,
              INITCOND = '0'
            );
          `,
          assertSqlStatements: (statements) => {
            const dropAggregateIndex = statements.findIndex((statement) =>
              statement.startsWith(
                "DROP AGGREGATE routine_rebuild.status_len_sum(integer)",
              ),
            );
            const dropFunctionIndex = statements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION routine_rebuild.status_len_state(",
              ),
            );

            expect(dropAggregateIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThanOrEqual(0);
            expect(dropAggregateIndex).toBeLessThan(dropFunctionIndex);
          },
        });
      }),
    );

    test(
      "constraint depending on invalidated SQL function is dropped before the function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA routine_rebuild_constraint;
            CREATE TABLE routine_rebuild_constraint.accounts (
              id integer PRIMARY KEY,
              status text NOT NULL
            );

            CREATE FUNCTION routine_rebuild_constraint.account_status_is_open(account_id integer)
            RETURNS boolean
            LANGUAGE sql
            STABLE
            BEGIN ATOMIC
              SELECT status::text = 'open'
              FROM routine_rebuild_constraint.accounts
              WHERE id = account_id;
            END;

            CREATE TABLE routine_rebuild_constraint.account_events (
              account_id integer NOT NULL,
              CONSTRAINT account_events_status_check
                CHECK (routine_rebuild_constraint.account_status_is_open(account_id))
            );
          `,
          testSql: dedent`
            ALTER TABLE routine_rebuild_constraint.account_events
              DROP CONSTRAINT account_events_status_check;
            DROP FUNCTION routine_rebuild_constraint.account_status_is_open(integer);
            ALTER TABLE routine_rebuild_constraint.accounts
              ALTER COLUMN status TYPE varchar(32);

            CREATE FUNCTION routine_rebuild_constraint.account_status_is_open(account_id integer)
            RETURNS boolean
            LANGUAGE sql
            STABLE
            BEGIN ATOMIC
              SELECT status::text = 'open'
              FROM routine_rebuild_constraint.accounts
              WHERE id = account_id;
            END;

            ALTER TABLE routine_rebuild_constraint.account_events
              ADD CONSTRAINT account_events_status_check
              CHECK (routine_rebuild_constraint.account_status_is_open(account_id));
          `,
          assertSqlStatements: (statements) => {
            const dropConstraintIndex = statements.findIndex(
              (statement) =>
                statement ===
                "ALTER TABLE routine_rebuild_constraint.account_events DROP CONSTRAINT account_events_status_check",
            );
            const dropFunctionIndex = statements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION routine_rebuild_constraint.account_status_is_open(",
              ),
            );

            expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThanOrEqual(0);
            expect(dropConstraintIndex).toBeLessThan(dropFunctionIndex);
          },
        });
      }),
    );
  });
}
