/**
 * Integration tests for PostgreSQL aggregate operations.
 */

import { describe, test } from "bun:test";
import dedent from "dedent";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`aggregate operations (pg${pgVersion})`, () => {
    test(
      "aggregate creation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
          CREATE AGGREGATE test_schema.collect_text(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
        `,
        });
      }),
    );

    test(
      "aggregate owner change",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text(text)
          (
            SFUNC = array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          CREATE ROLE aggregate_owner;
        `,
          testSql: dedent`
          ALTER AGGREGATE test_schema.collect_text(text) OWNER TO aggregate_owner;
        `,
        });
      }),
    );

    test(
      "aggregate drop",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text(text)
          (
            SFUNC = array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
        `,
          testSql: dedent`
          DROP AGGREGATE test_schema.collect_text(text);
        `,
        });
      }),
    );

    test(
      "aggregate depending on replaced transition function is recreated around the function",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;

          CREATE FUNCTION test_schema.amount_transition(state bigint, value integer)
          RETURNS bigint
          LANGUAGE sql
          IMMUTABLE
          AS $$ SELECT state + value $$;

          CREATE AGGREGATE test_schema.total_amount(integer)
          (
            SFUNC = test_schema.amount_transition,
            STYPE = bigint,
            INITCOND = '0'
          );
        `,
          testSql: dedent`
          DROP AGGREGATE test_schema.total_amount(integer);
          DROP FUNCTION test_schema.amount_transition(bigint, integer);

          CREATE FUNCTION test_schema.amount_transition(state numeric, value integer)
          RETURNS numeric
          LANGUAGE sql
          IMMUTABLE
          AS $$ SELECT state + value $$;

          CREATE AGGREGATE test_schema.total_amount(integer)
          (
            SFUNC = test_schema.amount_transition,
            STYPE = numeric,
            INITCOND = '0'
          );
        `,
        });
      }),
    );

    test(
      "aggregate comment creation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_comment(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
        `,
          testSql: dedent`
          COMMENT ON AGGREGATE test_schema.collect_text_comment(text) IS 'aggregate comment';
        `,
        });
      }),
    );

    test(
      "aggregate comment removal",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_comment_drop(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          COMMENT ON AGGREGATE test_schema.collect_text_comment_drop(text) IS 'aggregate comment';
        `,
          testSql: dedent`
          COMMENT ON AGGREGATE test_schema.collect_text_comment_drop(text) IS NULL;
        `,
        });
      }),
    );

    test(
      "aggregate comment creation depends on aggregate create order",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: dedent`
            CREATE AGGREGATE test_schema.collect_text_dependency(text)
            (
              SFUNC = pg_catalog.array_append,
              STYPE = text[],
              INITCOND = '{}'
            );

            COMMENT ON AGGREGATE test_schema.collect_text_dependency(text) IS 'dependency check';
          `,
          sortChangesCallback: (a, b) => {
            // force comment create ahead of aggregate create to ensure dependency sorting fixes the order
            const priority = (change: Change) => {
              if (
                change.objectType === "aggregate" &&
                change.scope === "comment" &&
                change.operation === "create"
              ) {
                return 0;
              }
              if (
                change.objectType === "aggregate" &&
                change.scope === "object" &&
                change.operation === "create"
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
      "aggregate grant privileges",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_priv(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          CREATE ROLE aggregate_executor;
        `,
          testSql: dedent`
          GRANT EXECUTE ON FUNCTION test_schema.collect_text_priv(text) TO aggregate_executor;
        `,
        });
      }),
    );

    test(
      "aggregate revoke privileges",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE AGGREGATE test_schema.collect_text_priv_revoke(text)
          (
            SFUNC = pg_catalog.array_append,
            STYPE = text[],
            INITCOND = '{}'
          );
          CREATE ROLE aggregate_executor;
          GRANT EXECUTE ON FUNCTION test_schema.collect_text_priv_revoke(text) TO aggregate_executor;
        `,
          testSql: dedent`
          REVOKE EXECUTE ON FUNCTION test_schema.collect_text_priv_revoke(text) FROM aggregate_executor;
        `,
        });
      }),
    );

    // Regression for CLI-1471: when an aggregate exists in branch but not
    // main, pg-delta must emit `CREATE AGGREGATE` alongside any GRANT on
    // the aggregate. Emitting the GRANT alone produced
    // `WARNING (01007): no privileges were granted for ...` at apply time
    // because the GRANT referenced an aggregate the planner had not
    // enumerated. The roundtripFidelityTest re-applies the generated
    // migration against main, which fails immediately if pg-delta produces
    // an orphan GRANT without the matching CREATE AGGREGATE.
    test(
      "aggregate create + grant roundtrips without orphan grant",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE ROLE aggregate_executor;",
          testSql: dedent`
          CREATE FUNCTION public.last_sfunc(state anyelement, value anyelement)
            RETURNS anyelement LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;
          CREATE AGGREGATE public.last(anyelement)
          (
            SFUNC = public.last_sfunc,
            STYPE = anyelement
          );
          GRANT ALL ON FUNCTION public.last(anyelement) TO aggregate_executor;
        `,
        });
      }),
    );

    // The wild report on CLI-1471 cited a GRANT with signature
    // `public.last(anyelement, any)`, which is the shape an
    // ordered-set / hypothetical-set aggregate produces in `proargtypes`
    // (the procedure path would emit that exact format). Aggregates with
    // `aggkind = 'o' | 'h'` go through the same enumeration code path as
    // plain aggregates (`prokind = 'a'`), and the procedure extractor's
    // `lanname not in ('c', 'internal')` filter excludes them, so the
    // ACL must be carried by the aggregate path. Lock that in.
    test(
      "ordered-set aggregate create + grant roundtrips without orphan grant",
      withDbIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE ROLE aggregate_executor;",
          testSql: dedent`
          CREATE FUNCTION public.os_last_sfunc(state anyelement, value anyelement)
            RETURNS anyelement LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;
          CREATE AGGREGATE public.os_last(anyelement ORDER BY anyelement)
          (
            SFUNC = public.os_last_sfunc,
            STYPE = anyelement
          );
          GRANT ALL ON FUNCTION public.os_last(anyelement, anyelement) TO aggregate_executor;
        `,
        });
      }),
    );
  });
}
