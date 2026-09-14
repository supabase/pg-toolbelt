/**
 * Baseline apply as Cloud's non-superuser `postgres` (branch = SOURCE, base =
 * DESIRED). Gated on `runSupabaseBareTests`.
 *
 * E1 (CLI-2301): base `public` owned by `postgres`, branch `public` owned by
 * `pg_database_owner`. The plan must reown `public` before creating into it.
 * E2 (CLI-2341): owner-asymmetric platform event trigger must not be re-created.
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

    test("E1: base public owned by postgres baselines onto a pg_database_owner branch as postgres", async () => {
      const branch: TestDb = await cluster.createDb("e1_branch");
      const base: TestDb = await cluster.createDb("e1_base");
      const applier = new pg.Pool({
        connectionString: branch.postgresUri!,
        max: 1,
      });
      applier.on("error", () => {});
      try {
        // Production Cloud: database owner is postgres, so pg_database_owner
        // membership is how a fresh branch's postgres holds CREATE on public.
        // nspowner stays pg_database_owner until ALTER SCHEMA.
        await cluster.adminPool.query(
          `ALTER DATABASE "${branch.name}" OWNER TO postgres`,
        );
        await cluster.adminPool.query(
          `ALTER DATABASE "${base.name}" OWNER TO postgres`,
        );
        await base.pool.query(`ALTER SCHEMA public OWNER TO postgres`);
        const basePg = new pg.Pool({
          connectionString: base.postgresUri!,
          max: 1,
        });
        basePg.on("error", () => {});
        try {
          await basePg.query(`CREATE TABLE public.items (id int primary key)`);
        } finally {
          await basePg.end();
        }

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
        const sqls = migration.actions.map((a) => a.sql);
        const ownerIdx = sqls.findIndex((s) =>
          /ALTER SCHEMA "public" OWNER TO "postgres"/.test(s),
        );
        expect(ownerIdx).toBeGreaterThanOrEqual(0);
        const createIdx = sqls.findIndex((s) =>
          /CREATE TABLE "public"\."items"/.test(s),
        );
        expect(createIdx).toBeGreaterThan(ownerIdx);
        const revokeIdx = sqls.findIndex((s) =>
          /REVOKE ALL ON SCHEMA "public" FROM "pg_database_owner"/.test(s),
        );
        if (revokeIdx >= 0) expect(revokeIdx).toBeGreaterThan(ownerIdx);
      } finally {
        await applier.end().catch(() => {});
        await branch.drop();
        await base.drop();
      }
    }, 120_000);

    test("E1b: public owned by supabase_admin on the base is not dropped from the branch", async () => {
      const branch: TestDb = await cluster.createDb("e1b_branch");
      const base: TestDb = await cluster.createDb("e1b_base");
      const applier = new pg.Pool({
        connectionString: branch.postgresUri!,
        max: 1,
      });
      applier.on("error", () => {});
      try {
        await cluster.adminPool.query(
          `ALTER DATABASE "${branch.name}" OWNER TO postgres`,
        );
        await cluster.adminPool.query(
          `ALTER DATABASE "${base.name}" OWNER TO postgres`,
        );
        const basePg = new pg.Pool({
          connectionString: base.postgresUri!,
          max: 1,
        });
        basePg.on("error", () => {});
        try {
          await basePg.query(`CREATE TABLE public.items (id int primary key)`);
        } finally {
          await basePg.end();
        }
        await base.pool.query(`ALTER SCHEMA public OWNER TO supabase_admin`);

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
          expect.stringMatching(/DROP SCHEMA "public"/),
        );
      } finally {
        await applier.end().catch(() => {});
        await branch.drop();
        await base.drop();
      }
    }, 120_000);

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
