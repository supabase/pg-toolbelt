/**
 * Integration tests for PostgreSQL function operations.
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  // TODO: Fix functions stable ids that must be the schema + name + argstypes because the current one is just the function name
  describe(`function operations (pg${pgVersion})`, () => {
    test(
      "keeps functions whose bodies embed non-transactional SQL text in one transactional unit",
      withDb(pgVersion, async (db) => {
        // The regex-based classifier this design replaced stripped comments,
        // naively split on ";", and pattern-matched each fragment — so the
        // dollar-quoted body below (multi-statement dynamic SQL mentioning
        // CREATE INDEX CONCURRENTLY and VACUUM) was misclassified as
        // non-transactional and lost plan atomicity. Trait-based
        // classification never inspects rendered SQL, so the whole plan must
        // stay one transactional unit and apply cleanly.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: dedent`
            CREATE TABLE public.users (
              id integer PRIMARY KEY,
              email text
            );

            CREATE FUNCTION public.rebuild_users_index() RETURNS void
            LANGUAGE plpgsql
            AS $function$
            BEGIN
              EXECUTE 'CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)';
              EXECUTE 'VACUUM FULL public.users; ALTER SYSTEM SET work_mem = ''64MB''';
            END;
            $function$;
          `,
          assertPlan: (plan) => {
            expect(plan.units).toHaveLength(1);
            expect(plan.units[0].transactionMode).toBe("transactional");
            expect(plan.units[0].reason).toBe("default");
          },
        });
      }),
    );

    test(
      "simple function creation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.add_numbers(a integer, b integer)
           RETURNS integer
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT $1 + $2$function$;
        `,
        });
      }),
    );

    test(
      "plpgsql function with security definer",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.get_user_count()
           RETURNS bigint
           LANGUAGE plpgsql
           STABLE SECURITY DEFINER
          AS $function$
          BEGIN
            RETURN (SELECT COUNT(*) FROM pg_catalog.pg_user);
          END;
          $function$;
        `,
        });
      }),
    );

    test(
      "function replacement",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.version_function()
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS 'SELECT ''v1.0''';
        `,
          testSql: dedent`
        CREATE OR REPLACE FUNCTION test_schema.version_function()
         RETURNS text
         LANGUAGE sql
         IMMUTABLE
        AS $function$SELECT 'v2.0'$function$;
      `,
        });
      }),
    );

    test(
      "begin atomic sql function replacement",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE TABLE test_schema.accounts (
              user_id int PRIMARY KEY,
              balance int NOT NULL DEFAULT 0
            );

            CREATE FUNCTION test_schema.transfer_funds(
              sender_id int, receiver_id int, amount numeric
            )
            RETURNS void
            LANGUAGE SQL
            BEGIN ATOMIC
              UPDATE test_schema.accounts
                SET balance = balance - amount WHERE user_id = sender_id;
            END;
          `,
          testSql: dedent`
            CREATE OR REPLACE FUNCTION test_schema.transfer_funds(
              sender_id int, receiver_id int, amount numeric
            )
            RETURNS void
            LANGUAGE SQL
            BEGIN ATOMIC
              UPDATE test_schema.accounts
                SET balance = balance - amount WHERE user_id = sender_id;
              UPDATE test_schema.accounts
                SET balance = balance + amount WHERE user_id = receiver_id;
            END;
          `,
        });
      }),
    );

    test(
      "begin atomic sql function depending on rewritten column is recreated",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE TABLE test_schema.accounts (
              user_id int PRIMARY KEY,
              balance int NOT NULL DEFAULT 0
            );

            CREATE FUNCTION test_schema.total_balance()
            RETURNS bigint
            LANGUAGE SQL
            STABLE
            BEGIN ATOMIC
              SELECT sum(balance)::bigint FROM test_schema.accounts;
            END;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.total_balance();

            ALTER TABLE test_schema.accounts
              ALTER COLUMN balance TYPE bigint
              USING balance::bigint;

            CREATE FUNCTION test_schema.total_balance()
            RETURNS bigint
            LANGUAGE SQL
            STABLE
            BEGIN ATOMIC
              SELECT sum(balance)::bigint FROM test_schema.accounts;
            END;
          `,
          assertSqlStatements: (statements) => {
            const dropIndex = statements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.total_balance"),
            );
            const alterIndex = statements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.accounts ALTER COLUMN balance TYPE bigint",
              ),
            );
            const createIndex = statements.findIndex(
              (statement) =>
                statement.startsWith("CREATE") &&
                statement.includes("FUNCTION test_schema.total_balance()"),
            );

            expect(dropIndex).toBeGreaterThanOrEqual(0);
            expect(alterIndex).toBeGreaterThan(dropIndex);
            expect(createIndex).toBeGreaterThan(alterIndex);
          },
        });
      }),
    );

    test(
      "function signature: parameter type change",
      withDb(pgVersion, async (db) => {
        // Changes the IN parameter type (text -> uuid). stableId changes
        // because argument_types is part of the procedure stableId, so this
        // exercises the drop+create path. PostgreSQL rejects
        // `CREATE OR REPLACE` for this kind of change.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE FUNCTION test_schema.process_item(param1 text)
            RETURNS void
            LANGUAGE plpgsql
            AS $function$
            BEGIN
              RAISE NOTICE 'Processing: %', param1;
            END;
            $function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.process_item(text);
            CREATE FUNCTION test_schema.process_item(param1 uuid)
            RETURNS void
            LANGUAGE plpgsql
            AS $function$
            BEGIN
              RAISE NOTICE 'Processing: %', param1::text;
            END;
            $function$;
          `,
        });
      }),
    );

    test(
      "function signature: parameter arity change",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE FUNCTION test_schema.process_item(param1 text)
            RETURNS void
            LANGUAGE plpgsql
            AS $function$
            BEGIN
              RAISE NOTICE 'Processing: %', param1;
            END;
            $function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.process_item(text);
            CREATE FUNCTION test_schema.process_item(param1 text, param2 integer)
            RETURNS void
            LANGUAGE plpgsql
            AS $function$
            BEGIN
              RAISE NOTICE 'Processing: % (%)', param1, param2;
            END;
            $function$;
          `,
        });
      }),
    );

    test(
      "function signature: parameter name change only",
      withDb(pgVersion, async (db) => {
        // Same argument_types means same stableId -> altered path. PostgreSQL
        // rejects `CREATE OR REPLACE FUNCTION` that renames an IN parameter
        // ("cannot change name of input parameter"), so the diff must emit
        // DROP + CREATE.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE FUNCTION test_schema.process_item(original_name text)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT original_name$function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.process_item(text);
            CREATE FUNCTION test_schema.process_item(renamed text)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT renamed$function$;
          `,
        });
      }),
    );

    test(
      "function signature: parameter default removed",
      withDb(pgVersion, async (db) => {
        // PostgreSQL: "cannot remove parameter defaults from existing function".
        // Requires DROP + CREATE.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE FUNCTION test_schema.get_greeting(name text DEFAULT 'world')
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT 'hello ' || name$function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.get_greeting(text);
            CREATE FUNCTION test_schema.get_greeting(name text)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT 'hello ' || name$function$;
          `,
        });
      }),
    );

    test(
      "function signature: return type change",
      withDb(pgVersion, async (db) => {
        // PostgreSQL: "cannot change return type of existing function".
        // Requires DROP + CREATE.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE FUNCTION test_schema.lookup(id integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT id$function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.lookup(integer);
            CREATE FUNCTION test_schema.lookup(id integer)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT id::text$function$;
          `,
        });
      }),
    );

    test(
      "function signature change cascades through a dependent view",
      withDb(pgVersion, async (db) => {
        // A signature change on a function referenced by a view must also
        // replace the view; the topological sort + replacement expansion is
        // responsible for this. The roundtrip asserts apply succeeds end-to-end.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;
            CREATE FUNCTION test_schema.format_id(id integer)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT 'id:' || id::text$function$;

            CREATE TABLE test_schema.items (id integer);
            CREATE VIEW test_schema.items_formatted AS
              SELECT test_schema.format_id(id) AS formatted_id FROM test_schema.items;
          `,
          testSql: dedent`
            DROP VIEW test_schema.items_formatted;
            DROP FUNCTION test_schema.format_id(integer);

            CREATE FUNCTION test_schema.format_id(id bigint)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$SELECT 'id:' || id::text$function$;

            CREATE VIEW test_schema.items_formatted AS
              SELECT test_schema.format_id(id::bigint) AS formatted_id FROM test_schema.items;
          `,
        });
      }),
    );

    test(
      "function overloading",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.format_value(input_val integer)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT input_val::text$function$;

          CREATE FUNCTION test_schema.format_value(input_val integer, prefix text)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT prefix || input_val::text$function$;
        `,
        });
      }),
    );

    test(
      "drop function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.temp_function()
          RETURNS text
          LANGUAGE sql
          AS 'SELECT ''temporary''';
        `,
          testSql: dedent`
          DROP FUNCTION test_schema.temp_function();
        `,
        });
      }),
    );

    test(
      "function with complex attributes",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.expensive_function(input_data text)
           RETURNS text
           LANGUAGE plpgsql
           PARALLEL RESTRICTED STRICT COST 1000
          AS $function$
          BEGIN
            -- Simulate expensive operation
            PERFORM pg_sleep(0.1);
            RETURN upper(input_data);
          END;
          $function$;
        `,
        });
      }),
    );

    test(
      "function with configuration parameters",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.config_function()
           RETURNS void
           LANGUAGE plpgsql
           SET work_mem TO '256MB'
           SET statement_timeout TO '30s'
          AS $function$
          BEGIN
            -- Function with custom configuration
            RAISE NOTICE 'Function executed with custom config';
          END;
          $function$;
        `,
        });
      }),
    );

    test(
      "function used in table default",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.get_timestamp()
           RETURNS timestamp with time zone
           LANGUAGE sql
           STABLE
          AS $function$SELECT NOW()$function$;

          CREATE TABLE test_schema.events (created_at timestamp with time zone DEFAULT test_schema.get_timestamp());
        `,
        });
      }),
    );

    test(
      "function no changes when identical",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE FUNCTION test_schema.stable_function()
          RETURNS integer
          LANGUAGE sql
          AS 'SELECT 42';
        `,
          testSql: ``,
        });
      }),
    );
  });

  // Function dependency ordering tests
  describe(`function dependency ordering (pg${pgVersion})`, () => {
    test(
      "function before constraint that uses it",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.validate_email(email text)
           RETURNS boolean
           LANGUAGE sql
           IMMUTABLE
          AS $function$
           SELECT email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'
          $function$;

          CREATE TABLE test_schema.users (email text);

          ALTER TABLE test_schema.users ADD CONSTRAINT valid_email CHECK (test_schema.validate_email(email));
        `,
        });
      }),
    );

    test(
      "function before view that uses it",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE TABLE test_schema.products (price numeric(10,2));

          CREATE FUNCTION test_schema.format_price(price numeric)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT '$' || price::text$function$;

          CREATE VIEW test_schema.product_display AS SELECT test_schema.format_price(price) AS formatted_price
          FROM test_schema.products;
        `,
        });
      }),
    );

    test(
      "plpgsql function body references are accepted even when helper is created later",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE OR REPLACE FUNCTION test_schema.a_wrapper(input text)
           RETURNS text
           LANGUAGE plpgsql
           IMMUTABLE
          AS $function$
          BEGIN
            RETURN test_schema.z_helper_parse(input) || '!';
          END;
          $function$;

          CREATE OR REPLACE FUNCTION test_schema.z_helper_parse(input text)
           RETURNS text
           LANGUAGE plpgsql
           IMMUTABLE
          AS $function$
          BEGIN
            RETURN upper(input);
          END;
          $function$;
        `,
        });
      }),
    );

    test(
      "sql function body references are protected by check_function_bodies setting",
      withDb(pgVersion, async (db) => {
        const schemaSql = "CREATE SCHEMA test_schema;";
        const sqlFunctions = dedent`
          SET check_function_bodies = off;

          CREATE OR REPLACE FUNCTION test_schema.a_wrapper(input text)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT test_schema.z_helper_parse(input) || '!'$function$;

          CREATE OR REPLACE FUNCTION test_schema.z_helper_parse(input text)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT upper(input)$function$;
        `;

        await db.main.query(schemaSql);
        await db.branch.query(schemaSql);
        await db.branch.query(sqlFunctions);

        const planResult = await createPlan(db.main, db.branch);
        if (!planResult) {
          throw new Error(
            "Expected a plan for SQL function body reference setup",
          );
        }

        expect(flattenPlanStatements(planResult.plan)[0]).toBe(
          "SET check_function_bodies = false",
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );
  });

  // Complex function scenario test
  describe(`complex function scenarios (pg${pgVersion})`, () => {
    test(
      "function with dependencies roundtrip",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE TABLE test_schema.metrics (name text NOT NULL, total_value numeric DEFAULT 0, count_value integer DEFAULT 0);
        
          CREATE FUNCTION test_schema.safe_divide(numerator numeric, denominator numeric)
           RETURNS numeric
           LANGUAGE sql
           IMMUTABLE STRICT
          AS $function$
            SELECT CASE
              WHEN denominator = 0 THEN NULL
              ELSE numerator / denominator
            END
          $function$;

          CREATE VIEW test_schema.metric_averages AS SELECT name,
              test_schema.safe_divide(total_value, (count_value)::numeric) AS average_value
             FROM test_schema.metrics
            WHERE (count_value > 0);

          CREATE FUNCTION test_schema.get_metric_summary(metric_id integer)
           RETURNS text
           LANGUAGE plpgsql
           STABLE
          AS $function$
          DECLARE
            metric_name text;
            avg_val numeric;
          BEGIN
            SELECT m.name, test_schema.safe_divide(m.total_value, m.count_value::numeric)
            INTO metric_name, avg_val
            FROM test_schema.metrics m
            WHERE m.id = metric_id;

            RETURN metric_name || ': ' || COALESCE(avg_val::text, 'N/A');
          END;
          $function$;
        `,
        });
      }),
    );

    test(
      "function comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE FUNCTION test_schema.greet(name text)
           RETURNS text
           LANGUAGE sql
           IMMUTABLE
          AS $function$SELECT 'Hello, ' || name$function$;

          COMMENT ON FUNCTION test_schema.greet(text) IS 'greet function';
        `,
        });
      }),
    );
  });
}
