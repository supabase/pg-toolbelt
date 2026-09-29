/**
 * CLI-2341 E2: both catalogs already have `issue_pg_graphql_access`; the
 * branch copy is owned by `supabase_admin` (Rule 6 hides it) and the base
 * copy is owned by `postgres` (old-project shape). Apply as the non-superuser
 * `postgres` must not emit CREATE of the trigger that already exists.
 *
 * E3 / CLI-2300: user objects whose prerequisite the policy withholds
 * (pgsodium, a reference-only `supabase_migrations` table) and the branch
 * lacks are skipped with a warning instead of failing the apply.
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

    test("E3: a postgres-owned TCE table plans on a pgsodium-less branch without pgsodium references", async () => {
      const branch: TestDb = await cluster.createDb("e3_branch");
      const base: TestDb = await cluster.createDb("e3_base");
      // Supabase hands `postgres` the database (so it owns `public`).
      for (const db of [branch, base]) {
        await cluster.adminPool.query(
          `ALTER DATABASE "${db.name}" OWNER TO postgres`,
        );
      }
      const applier = new pg.Pool({
        connectionString: branch.postgresUri!,
        max: 1,
      });
      applier.on("error", () => {});
      // `base.pool` is supabase_admin: a table it creates is system-owned and
      // the owner rule hides it regardless of the pgsodium references.
      const baseAsPostgres = new pg.Pool({
        connectionString: base.postgresUri!,
        max: 1,
      });
      baseAsPostgres.on("error", () => {});
      try {
        await base.pool.query(`CREATE EXTENSION IF NOT EXISTS pgsodium`);
        await baseAsPostgres.query(`
          CREATE TABLE public.creds (
            id int primary key,
            secret text,
            key_id uuid default (pgsodium.create_key()).id,
            nonce bytea default pgsodium.crypto_aead_det_noncegen());
        `);
        await base.pool.query(`
          SECURITY LABEL FOR pgsodium ON COLUMN public.creds.secret
            IS 'ENCRYPT WITH KEY COLUMN key_id NONCE nonce';
        `);

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
        const sql = migration.actions.map((a) => a.sql);
        expect(sql).toContainEqual(
          expect.stringMatching(/^CREATE TABLE "public"\."creds"/),
        );
        expect(sql.some((s) => /pgsodium/i.test(s))).toBe(false);
        expect(sql.some((s) => /CREATE EXTENSION/i.test(s))).toBe(false);
        expect(
          (migration.diagnostics ?? []).some(
            (d) => d.code === "excluded-by-cascade",
          ),
        ).toBe(true);
        const exists = await applier.query(
          `SELECT to_regclass('public.creds') IS NOT NULL AS present`,
        );
        expect(exists.rows[0].present).toBe(true);
        // Re-planning the applied branch is stable: the skipped TCE artefacts
        // are skipped again rather than refused.
        const applied = await profile.extract(applier);
        const again = plan(applied.factBase, desired.factBase, {
          ...profile.planOptions,
          renames: "off",
          compact: true,
        });
        expect(again.actions.map((a) => a.sql)).toEqual([]);
      } finally {
        await applier.end().catch(() => {});
        await baseAsPostgres.end().catch(() => {});
        await branch.drop();
        await base.drop();
      }
    }, 120_000);

    test("CLI-2300: a user trigger on postgres-owned schema_migrations is skipped on a branch without it", async () => {
      const branch: TestDb = await cluster.createDb("cli2300_branch");
      const base: TestDb = await cluster.createDb("cli2300_base");
      // Supabase hands `postgres` the database (so it owns `public`).
      for (const db of [branch, base]) {
        await cluster.adminPool.query(
          `ALTER DATABASE "${db.name}" OWNER TO postgres`,
        );
      }
      const applier = new pg.Pool({
        connectionString: branch.postgresUri!,
        max: 1,
      });
      applier.on("error", () => {});
      const baseAsPostgres = new pg.Pool({
        connectionString: base.postgresUri!,
        max: 1,
      });
      baseAsPostgres.on("error", () => {});
      try {
        await base.pool.query(
          `CREATE SCHEMA supabase_migrations AUTHORIZATION postgres`,
        );
        await baseAsPostgres.query(`
          CREATE TABLE supabase_migrations.schema_migrations (
            version text PRIMARY KEY
          );
          CREATE FUNCTION public.on_mig() RETURNS trigger LANGUAGE plpgsql
            AS $$ BEGIN RETURN NEW; END $$;
          CREATE TRIGGER block_writes
            BEFORE INSERT ON supabase_migrations.schema_migrations
            FOR EACH ROW EXECUTE FUNCTION public.on_mig();
        `);

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
        const sql = migration.actions.map((a) => a.sql);
        expect(sql.some((s) => /schema_migrations/i.test(s))).toBe(false);
        expect(sql).toContainEqual(expect.stringMatching(/on_mig/));
        expect(
          (migration.diagnostics ?? []).some(
            (d) => d.code === "excluded-by-cascade",
          ),
        ).toBe(true);
        const applied = await profile.extract(applier);
        const replan = plan(applied.factBase, desired.factBase, {
          ...profile.planOptions,
          renames: "off",
          compact: true,
        });
        expect(replan.source.fingerprint).toBe(migration.target.fingerprint);
      } finally {
        await applier.end().catch(() => {});
        await baseAsPostgres.end().catch(() => {});
        await branch.drop();
        await base.drop();
      }
    }, 120_000);
  },
);
