/**
 * CLI-2341 E2: both catalogs already have `issue_pg_graphql_access`; the
 * branch copy is owned by `supabase_admin` (Rule 6 hides it) and the base
 * copy is owned by `postgres` (old-project shape). Apply as the non-superuser
 * `postgres` must not emit CREATE of the trigger that already exists.
 *
 * Same shape as the CLI baseline apply: branch is SOURCE, base is DESIRED,
 * apply as `postgres`. Gated on `runSupabaseBareTests`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { resolveProfile } from "../src/integrations/profile.ts";
import { supabaseProfile } from "../src/integrations/supabase.ts";
import { plan } from "../src/plan/plan.ts";
import {
  runSupabaseBareTests,
  supabaseCluster,
  type Cluster,
  type TestDb,
} from "./containers.ts";

describe.skipIf(!runSupabaseBareTests)(
  "supabase profile — baseline applied as the non-superuser postgres",
  () => {
    let cluster: Cluster;

    beforeAll(async () => {
      cluster = await supabaseCluster();
    }, 180_000);

    test("E2: postgres-owned platform event trigger is not re-created on the branch", async () => {
      const branch: TestDb = await cluster.createDb("e2_branch");
      const base: TestDb = await cluster.createDb("e2_base");
      const applier = new pg.Pool({
        connectionString: branch.postgresUri!,
        max: 1,
      });
      applier.on("error", () => {});
      try {
        // createDb templates template1, which does not carry the image's
        // platform event triggers (those live on the postgres database).
        // Seed the production shape on both sides: supabase_admin-owned
        // function in assumed `extensions`, trigger of the issue_* set.
        for (const db of [branch, base]) {
          await db.pool.query(`
            CREATE SCHEMA IF NOT EXISTS extensions;
            CREATE OR REPLACE FUNCTION extensions.grant_pg_graphql_access()
              RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$;
            ALTER FUNCTION extensions.grant_pg_graphql_access() OWNER TO supabase_admin;
            CREATE EVENT TRIGGER issue_pg_graphql_access
              ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
              EXECUTE FUNCTION extensions.grant_pg_graphql_access();
          `);
        }
        // ALTER EVENT TRIGGER … OWNER TO a non-superuser is refused; this is
        // the only way to reproduce the old-project catalog shape.
        const owned = await base.pool.query(
          `UPDATE pg_event_trigger SET evtowner = 'postgres'::regrole WHERE evtname = 'issue_pg_graphql_access'`,
        );
        expect(owned.rowCount).toBe(1);

        const profile = await resolveProfile(applier, supabaseProfile);
        const [src, desired] = await Promise.all([
          profile.extract(applier),
          profile.extract(base.pool),
        ]);
        const migration = plan(src.factBase, desired.factBase, {
          ...profile.planOptions,
          renames: "off",
          compact: true,
        });
        const report = await apply(migration, applier, {
          ...profile.applyOptions,
        });

        expect(report.status).toBe("applied");
        expect(migration.actions.map((a) => a.sql)).not.toContainEqual(
          expect.stringMatching(
            /CREATE EVENT TRIGGER "issue_pg_graphql_access"/,
          ),
        );
      } finally {
        await applier.end().catch(() => {});
        await branch.drop();
        await base.drop();
      }
    }, 120_000);
  },
);
