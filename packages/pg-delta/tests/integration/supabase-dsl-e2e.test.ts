import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
import { compileSerializeDSL } from "../../src/core/integrations/serialize/dsl.ts";
import { supabase as supabaseIntegration } from "../../src/core/integrations/supabase.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { withDbSupabaseIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

const pgVersion = 17;

const installPgNetSql = dedent`
  CREATE EXTENSION IF NOT EXISTS pg_net;
`;

const dropPgNetSql = "DROP EXTENSION pg_net;";

describe(`supabase integration e2e (pg${pgVersion})`, () => {
  test(
    "captures user-defined triggers attached to auth.users",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      // Regression for https://github.com/supabase/pg-toolbelt/issues/254 —
      // a user-attached trigger on `auth.users` (calling a function in
      // `public`) was being filtered out by the Supabase managed-schema
      // exclusion. The whole `auth` schema is on the deny list, but the
      // trigger function lives in `public`, which is the user-defined
      // signal the filter should respect.
      //
      // Run the SQL as `postgres` to mirror what `supabase db diff` does
      // — the test container connects as `supabase_admin`, but the CLI
      // (and migrations) operate as `postgres`, so functions created
      // through the normal path are owned by `postgres` rather than
      // `supabase_admin`.
      await db.branch.query(dedent`
        SET ROLE postgres;

        CREATE FUNCTION public.handle_new_user()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$ BEGIN RETURN NEW; END $$;

        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

        RESET ROLE;
      `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      expect(planResult?.plan.statements).toMatchInlineSnapshot(`
        [
          "SET check_function_bodies = false",
          
        "CREATE FUNCTION public.handle_new_user()
         RETURNS trigger
         LANGUAGE plpgsql
        AS $function$ BEGIN RETURN NEW; END $function$"
        ,
          "CREATE TRIGGER on_auth_user_created AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION handle_new_user()",
          "ALTER FUNCTION public.handle_new_user() OWNER TO postgres",
        ]
      `);
    }),
    120_000,
  );

  test(
    "captures pg_net extension drops in createPlan",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.main.query(installPgNetSql);
      await db.branch.query(installPgNetSql);
      await db.branch.query(dropPgNetSql);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      expect(planResult).not.toBeNull();
      expect(planResult?.plan.statements).toMatchInlineSnapshot(`
        [
          "DROP EXTENSION pg_net",
        ]
      `);
    }),
    120_000,
  );

  test(
    "roundtrips pg_net extension drops through the supabase integration",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.main.query(installPgNetSql);
      await db.branch.query(installPgNetSql);
      await db.branch.query(dropPgNetSql);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      expect(planResult).not.toBeNull();

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        integration: {
          filter: compileFilterDSL(supabaseIntegration.filter),
          serialize: compileSerializeDSL(supabaseIntegration.serialize),
        },
        assertSqlStatements: (sqlStatements) => {
          expect(sqlStatements).toMatchInlineSnapshot(`
            [
              "DROP EXTENSION pg_net",
            ]
          `);
        },
      });
    }),
    120_000,
  );

  // Regression for CLI-1470: Wasm-based foreign data wrappers (e.g.
  // `clerk`, `clerk_oauth`) wire their handler/validator through the
  // `extensions.*` schema. Supabase Cloud provisions them as
  // `supabase_admin`, but local Docker images do not have an equivalent
  // pre-step, so `supabase db reset` cannot replay
  // `CREATE FOREIGN DATA WRAPPER`. The Supabase integration filter must
  // suppress these FDW changes regardless of who owns the wrapper at
  // diff time.
  test(
    "suppresses CREATE FOREIGN DATA WRAPPER backed by extensions.* handler",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.branch.query(dedent`
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
        CREATE FOREIGN DATA WRAPPER wasm_lookalike
          HANDLER extensions.postgres_fdw_handler
          VALIDATOR extensions.postgres_fdw_validator;
      `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      // postgres_fdw is allow-listed for CREATE EXTENSION; the only
      // expected output is the extension itself. No
      // `CREATE FOREIGN DATA WRAPPER` for the Wasm-lookalike wrapper
      // should appear, since it depends on a handler that lives in the
      // managed `extensions` schema.
      const statements = planResult?.plan.statements ?? [];
      const fdwStatements = statements.filter((stmt) =>
        stmt.includes("FOREIGN DATA WRAPPER"),
      );
      expect(fdwStatements).toStrictEqual([]);
    }),
    120_000,
  );

  // Follow-up to CLI-1470: suppress SERVER / FOREIGN TABLE / USER MAPPING
  // that depend on Wasm FDWs whose handler lives in `extensions.*`. Without
  // this, `db pull` emits `CREATE SERVER ... FOREIGN DATA WRAPPER clerk_oauth`
  // while the wrapper DDL is suppressed, and local `supabase db reset` fails
  // with `foreign-data wrapper "clerk_oauth" does not exist`.
  test(
    "suppresses Wasm FDW server, foreign table, and user mapping dependents",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.branch.query(dedent`
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
        CREATE FOREIGN DATA WRAPPER wasm_lookalike
          HANDLER extensions.postgres_fdw_handler
          VALIDATOR extensions.postgres_fdw_validator;
        CREATE SERVER wasm_server FOREIGN DATA WRAPPER wasm_lookalike;
        CREATE SCHEMA wasm_fdw_test;
        CREATE FOREIGN TABLE wasm_fdw_test.remote_row (id integer)
          SERVER wasm_server
          OPTIONS (schema_name 'public', table_name 'remote_row');
        CREATE USER MAPPING FOR postgres SERVER wasm_server
          OPTIONS (user 'remote', password 'secret');
      `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      const statements = planResult?.plan.statements ?? [];
      const wasmDependentStatements = statements.filter(
        (stmt) =>
          /\bCREATE\s+SERVER\s+wasm_server\b/i.test(stmt) ||
          /\bCREATE\s+FOREIGN\s+TABLE\b[^;]*\bwasm_fdw_test\.remote_row\b/i.test(
            stmt,
          ) ||
          /\bCREATE\s+USER\s+MAPPING\b[^;]*\bSERVER\s+wasm_server\b/i.test(
            stmt,
          ),
      );
      expect(wasmDependentStatements).toStrictEqual([]);
    }),
    120_000,
  );

  // Regression for CLI-1469. `GRANT`/`REVOKE ... ON FOREIGN DATA WRAPPER`
  // requires superuser. On Supabase Cloud `postgres` has the elevated
  // rights; the local Docker image does not, so `supabase db reset`
  // aborts with `permission denied for foreign-data wrapper`. The
  // existing `*/owner` rule drops FDW ACL owned by `supabase_admin`;
  // this test pins the post-restore case where `pg_dump` rewrites
  // OWNER TO `postgres` and the owner gate no longer matches.
  test(
    "suppresses GRANT/REVOKE on FOREIGN DATA WRAPPER even when owned by postgres",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.main.query(dedent`
        CREATE ROLE fdw_user;
        CREATE FOREIGN DATA WRAPPER user_fdw;
        GRANT ALL ON FOREIGN DATA WRAPPER user_fdw TO fdw_user;
      `);
      await db.branch.query(dedent`
        CREATE ROLE fdw_user;
        CREATE FOREIGN DATA WRAPPER user_fdw;
      `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      const statements = planResult?.plan.statements ?? [];
      const fdwAclStatements = statements.filter((stmt) =>
        /\b(?:GRANT|REVOKE)\b[^;]*\bON\b[^;]*\bFOREIGN\s+DATA\s+WRAPPER\b/.test(
          stmt,
        ),
      );
      expect(fdwAclStatements).toStrictEqual([]);
    }),
    120_000,
  );

  // Companion to the rule above: user-owned FOREIGN SERVER ACL must
  // still roundtrip. Server GRANT/REVOKE doesn't require superuser, so
  // a user-created server (e.g. a `dblink`/`postgres_fdw` server
  // pointing to a peer DB) is genuinely user-declarative state and
  // should not be swept up by the FDW ACL suppression.
  test(
    "preserves GRANT on user-owned FOREIGN SERVER",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.main.query(dedent`
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
        CREATE ROLE server_user;
        SET ROLE postgres;
        CREATE SERVER user_server FOREIGN DATA WRAPPER postgres_fdw;
        RESET ROLE;
      `);
      await db.branch.query(dedent`
        CREATE EXTENSION IF NOT EXISTS postgres_fdw SCHEMA extensions;
        CREATE ROLE server_user;
        SET ROLE postgres;
        CREATE SERVER user_server FOREIGN DATA WRAPPER postgres_fdw;
        GRANT USAGE ON FOREIGN SERVER user_server TO server_user;
        RESET ROLE;
      `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      const statements = planResult?.plan.statements ?? [];
      // pg-delta serializes server ACL with the `ON SERVER` shorthand
      // rather than `ON FOREIGN SERVER` (both are equivalent in PG) and
      // collapses a complete privilege set to `ALL`.
      expect(statements).toContain(
        "GRANT ALL ON SERVER user_server TO server_user",
      );
    }),
    120_000,
  );

  // Regression for the pgmq-1.4.4 cloud projects (real-world: this
  // bug fired during `supabase db pull --diff-engine pg-delta` against
  // a project with several pgmq queues, where every `pgmq.q_*` /
  // `pgmq.a_*` table was missing the `pg_depend deptype='e'` link to
  // the pgmq extension). The trigger extractor's principled filter
  // (`extension_table_oids` in trigger.model.ts) drops user triggers
  // on tables that carry that link, so on a healthy pgmq install the
  // bug never surfaces; we simulate the stale-cloud state by deleting
  // the link directly, which forces the same code path the cloud
  // project exercises and pins the supabase-filter-level fallback.
  test(
    "suppresses user triggers on pgmq queue tables when pg_depend link is missing",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.branch.query(dedent`
        CREATE EXTENSION pgmq;
        SELECT pgmq.create('processed_milestones_queue');

        DELETE FROM pg_depend
         WHERE objid = 'pgmq.q_processed_milestones_queue'::regclass
           AND refclassid = 'pg_extension'::regclass
           AND deptype = 'e';
        DELETE FROM pg_depend
         WHERE objid = 'pgmq.a_processed_milestones_queue'::regclass
           AND refclassid = 'pg_extension'::regclass
           AND deptype = 'e';

        CREATE FUNCTION public.move_data_from_queue() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

        CREATE TRIGGER after_insert_processed_milestones_queue
          AFTER INSERT ON pgmq.q_processed_milestones_queue
          FOR EACH ROW EXECUTE FUNCTION public.move_data_from_queue();
      `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      const statements = planResult?.plan.statements ?? [];
      const queueTriggerStatements = statements.filter((stmt) =>
        /\bCREATE\s+TRIGGER\b[^;]*\bON\s+pgmq\.q_processed_milestones_queue\b/i.test(
          stmt,
        ),
      );
      expect(queueTriggerStatements).toStrictEqual([]);
    }),
    120_000,
  );
});
