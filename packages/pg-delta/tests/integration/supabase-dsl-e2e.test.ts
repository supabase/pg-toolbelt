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
});
