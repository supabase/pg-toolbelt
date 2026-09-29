/**
 * `schema export --profile supabase` of an extension whose control file pins
 * a platform schema that a fresh Supabase database does not have (pgmq →
 * `pgmq`, pg_tle → `pgtle`). The policy treats those schemas as assumed and
 * never exports them, so the files must replay with the bare CREATE EXTENSION
 * that lets Postgres create the pinned schema (supabase/cli#6728).
 *
 * Extraction runs as the non-superuser `postgres` role, as on a real project.
 * Supabase image only — gated by `runSupabaseBareTests`.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { resolveProfile } from "../src/integrations/profile.ts";
import { supabaseProfile } from "../src/integrations/supabase.ts";
import { apply } from "../src/apply/apply.ts";
import { plan } from "../src/plan/plan.ts";
import { runSupabaseBareTests, supabaseCluster } from "./containers.ts";

describe.skipIf(!runSupabaseBareTests)(
  "supabase export: control-file-pinned extension schemas",
  () => {
    test("pgmq / pg_tle export bare and replay into a fresh database", async () => {
      const cluster = await supabaseCluster();
      const src = await cluster.createDb("pin_export_src");
      const shadow = await cluster.createDb("pin_export_shadow");
      const userPool = new pg.Pool({
        connectionString: src.postgresUri,
        max: 2,
      });
      try {
        await src.pool.query(`CREATE EXTENSION pgmq`);
        await src.pool.query(`CREATE EXTENSION pg_tle`);

        const exported = await buildSchemaExport(userPool, {
          profile: supabaseProfile,
        });
        const files = exported.files.filter((f) =>
          /_cluster\/extensions\/(pgmq|pg_tle)\.sql$/.test(f.name),
        );
        expect(files.map((f) => `${f.name}: ${f.sql.split("\n")[0]}`))
          .toMatchInlineSnapshot(`
            [
              "_cluster/extensions/pg_tle.sql: CREATE EXTENSION "pg_tle";",
              "_cluster/extensions/pgmq.sql: CREATE EXTENSION "pgmq";",
            ]
          `);

        await loadSqlFiles(files, shadow.pool);
        const { rows } = await shadow.pool.query(
          `SELECT extname, extnamespace::regnamespace::text AS schema
             FROM pg_extension WHERE extname IN ('pgmq', 'pg_tle')
            ORDER BY extname`,
        );
        expect(rows).toEqual([
          { extname: "pg_tle", schema: "pgtle" },
          { extname: "pgmq", schema: "pgmq" },
        ]);

        const ctx = await resolveProfile(userPool, supabaseProfile);
        const srcFb = (await ctx.extract(userPool)).factBase;
        const shadowFb = (await ctx.extract(shadow.pool)).factBase;
        const residual = plan(shadowFb, srcFb, {
          ...ctx.planOptions,
          renames: "off",
        })
          .actions.map((a) => a.sql)
          .filter((sql) => /pgmq|pg_tle|pgtle/.test(sql));
        expect(residual).toEqual([]);
      } finally {
        await userPool.end();
        await Promise.all([src.drop(), shadow.drop()]);
      }
    }, 300_000);

    test("DB-to-DB: pgmq / pg_tle planned onto a fresh database apply bare", async () => {
      const cluster = await supabaseCluster();
      const desired = await cluster.createDb("pin_plan_desired");
      const target = await cluster.createDb("pin_plan_target");
      try {
        await desired.pool.query(`CREATE EXTENSION pgmq`);
        await desired.pool.query(`CREATE EXTENSION pg_tle`);

        const ctx = await resolveProfile(target.pool, supabaseProfile);
        const targetFb = (await ctx.extract(target.pool)).factBase;
        const desiredFb = (await ctx.extract(desired.pool)).factBase;
        const thePlan = plan(targetFb, desiredFb, {
          ...ctx.planOptions,
          renames: "off",
        });
        expect(
          thePlan.actions
            .map((a) => a.sql)
            .filter((sql) => /CREATE EXTENSION "(pgmq|pg_tle)"/.test(sql))
            .sort(),
        ).toEqual([`CREATE EXTENSION "pg_tle"`, `CREATE EXTENSION "pgmq"`]);

        await apply(thePlan, target.pool);
        const { rows } = await target.pool.query(
          `SELECT extname, extnamespace::regnamespace::text AS schema
             FROM pg_extension WHERE extname IN ('pgmq', 'pg_tle')
            ORDER BY extname`,
        );
        expect(rows).toEqual([
          { extname: "pg_tle", schema: "pgtle" },
          { extname: "pgmq", schema: "pgmq" },
        ]);
      } finally {
        await Promise.all([desired.drop(), target.drop()]);
      }
    }, 300_000);
  },
);
