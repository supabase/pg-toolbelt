/**
 * Supabase-profile default-privilege plans against a full-stack database
 * (bare image + the committed base-init fixture), applied as `postgres`.
 * Gated on `runSupabaseBareTests`.
 *
 * - #629: a new table in a user schema keeps the grants postgres's default
 *   privileges gave it at creation, because the plan predicts the desired
 *   owner's implicit grants instead of the creating role's.
 * - #630: every `schema apply` on an unchanged database plans
 *   `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO PUBLIC`: the
 *   base-init `{postgres=X/postgres}` entry in `public` is read as "PUBLIC lost
 *   EXECUTE", and the co-located shadow has no such entry.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import { planSchemaFiles } from "../src/frontends/schema-plan.ts";
import { provisionCoLocatedShadow } from "../src/frontends/shadow.ts";
import { resolveProfile } from "../src/integrations/profile.ts";
import { supabaseProfile } from "../src/integrations/supabase.ts";
import { plan } from "../src/plan/plan.ts";
import {
  runSupabaseBareTests,
  startStandaloneSupabase,
  type StartedStandaloneSupabase,
} from "./containers.ts";
import { applySupabaseBaseInit } from "./supabase-base-init.ts";

const stacks: StartedStandaloneSupabase[] = [];
const pools: pg.Pool[] = [];
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
  await Promise.all(stacks.map((s) => s.stop().catch(() => {})));
});

/** A full-stack Supabase database: base-init replayed, `postgres` connection. */
async function fullStack(): Promise<pg.Pool> {
  const stack = await startStandaloneSupabase();
  stacks.push(stack);
  const admin = new pg.Pool({ connectionString: stack.connectionUri() });
  await applySupabaseBaseInit(admin).finally(() => admin.end());
  const pool = new pg.Pool({
    connectionString: stack.postgresConnectionUri(),
    max: 3,
  });
  pool.on("error", () => {});
  pools.push(pool);
  return pool;
}

describe.skipIf(!runSupabaseBareTests)(
  "supabase profile: default privileges on a full-stack database",
  () => {
    // https://github.com/supabase/pg-toolbelt/issues/629
    // test.failing: the new table keeps service_role's SELECT from postgres's
    // default privilege (REVOKE ALL FROM postgres + GRANT ... TO postgres is
    // planned instead of REVOKE SELECT FROM service_role).
    test.failing(
      "a new user-schema table does not keep default-privilege grants it should not have",
      async () => {
        const [source, desired] = await Promise.all([fullStack(), fullStack()]);
        await source.query(`
        CREATE SCHEMA app;
        ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO service_role;
      `);
        await desired.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint);
        ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO service_role;
      `);

        const profile = await resolveProfile(source, supabaseProfile);
        const [src, dst] = await Promise.all([
          profile.extract(source),
          profile.extract(desired),
        ]);
        const migration = plan(src.factBase, dst.factBase, {
          ...profile.planOptions,
          renames: "off",
          compact: true,
        });
        const report = await apply(migration, source, {
          ...profile.applyOptions,
        });
        expect(report.status).toBe("applied");

        const { rows } = await source.query<{ can: boolean }>(
          `SELECT has_table_privilege('service_role', 'app.t', 'SELECT') AS can`,
        );
        expect(rows[0]!.can).toBe(false);
      },
      300_000,
    );

    // https://github.com/supabase/pg-toolbelt/issues/630
    // test.failing: the unchanged database plans a GRANT EXECUTE ON FUNCTIONS
    // TO PUBLIC default privilege on every run.
    test.failing(
      "schema apply on an unchanged database plans nothing",
      async () => {
        const target = await startStandaloneSupabase();
        stacks.push(target);
        const admin = new pg.Pool({ connectionString: target.connectionUri() });
        await applySupabaseBaseInit(admin).finally(() => admin.end());
        const targetPg = new pg.Pool({
          connectionString: target.postgresConnectionUri(),
          max: 3,
        });
        targetPg.on("error", () => {});
        pools.push(targetPg);

        const exported = await buildSchemaExport(targetPg, {
          profile: supabaseProfile,
          layout: "grouped",
        });
        const shadow = await provisionCoLocatedShadow(
          target.postgresConnectionUri(),
        );
        const shadowPg = new pg.Pool({ connectionString: shadow.url, max: 3 });
        shadowPg.on("error", () => {});
        pools.push(shadowPg);
        try {
          const planned = await planSchemaFiles(
            targetPg,
            shadowPg,
            exported.files,
            {
              profile: supabaseProfile,
              manifest: exported.manifest,
              seedAssumedSchemas: true,
            },
          );
          expect(planned.plan.actions.map((a) => a.sql)).toEqual([]);
        } finally {
          await shadow.cleanup();
        }
      },
      300_000,
    );
  },
);
