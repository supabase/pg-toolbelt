/**
 * #476: under the Supabase profile, a declarative file may own the PostgREST
 * exposure and limit settings (`pgrst.db_schemas`, …) of the API roles in
 * database scope. Runs schema-plan as the
 * non-superuser `postgres` against a separate (isolated) shadow server, as the
 * Supabase CLI does. Every plan loads into a fresh database on the SAME shadow
 * server on purpose: it keeps the previous load's cluster-global settings, and
 * a deleted line must still plan a RESET.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import { planSchemaFiles } from "../src/frontends/schema-plan.ts";
import { provisionCoLocatedShadow } from "../src/frontends/shadow.ts";
import type { SqlFile } from "../src/frontends/load-sql-files.ts";
import { supabaseProfile } from "../src/integrations/supabase.ts";
import {
  runSupabaseBareTests,
  startStandaloneSupabase,
  type StartedStandaloneSupabase,
} from "./containers.ts";

const servers: StartedStandaloneSupabase[] = [];
const pools: pg.Pool[] = [];
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
  await Promise.all(servers.map((s) => s.stop().catch(() => {})));
});

function open(uri: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: uri, max: 3 });
  pool.on("error", () => {});
  pools.push(pool);
  return pool;
}

const TABLE = "CREATE TABLE public.i476 (id integer);\n";
const files = (roleSql = ""): SqlFile[] => [
  { name: "public/tables/i476.sql", sql: TABLE },
  ...(roleSql === "" ? [] : [{ name: "roles.sql", sql: roleSql }]),
];

/** The rejection message of `promise` (undefined when it resolves). */
const failureOf = (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  );

async function authenticatorConfig(pool: pg.Pool): Promise<string[]> {
  const r = await pool.query<{ cfg: string[] | null }>(`
    SELECT s.setconfig AS cfg FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole
    WHERE r.rolname = 'authenticator' AND s.setdatabase = 0`);
  return (r.rows[0]?.cfg ?? []).filter((c) => c.startsWith("pgrst."));
}

describe.skipIf(!runSupabaseBareTests)(
  "supabase profile — pgrst role settings in database scope (#476)",
  () => {
    test("plan, converge, change, reset, export; other role changes refused", async () => {
      const [targetServer, shadowServer] = await Promise.all([
        startStandaloneSupabase(),
        startStandaloneSupabase(),
      ]);
      servers.push(targetServer, shadowServer);
      await open(targetServer.postgresConnectionUri()).query(
        `CREATE DATABASE i476_target`,
      );
      const target = open(targetServer.postgresConnectionUri("i476_target"));
      const shadowAdmin = open(shadowServer.postgresConnectionUri());
      await target.query(TABLE);
      let shadows = 0;
      const freshShadow = async (): Promise<pg.Pool> => {
        const name = `i476_shadow_${++shadows}`;
        await shadowAdmin.query(`CREATE DATABASE ${name}`);
        return open(shadowServer.postgresConnectionUri(name));
      };

      const sync = async (roleSql: string) =>
        planSchemaFiles(target, await freshShadow(), files(roleSql), {
          profile: supabaseProfile,
          isolatedShadow: true,
        });
      const sqlOf = async (roleSql: string) =>
        (await sync(roleSql)).plan.actions.map((a) => a.sql);

      const setLine = `ALTER ROLE "authenticator" SET "pgrst.db_schemas" = 'pgrst_no_exposed_schemas';\n`;

      const first = await sync(setLine);
      expect(first.plan.actions.map((a) => a.sql)).toEqual([
        `ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO 'pgrst_no_exposed_schemas'`,
      ]);

      const report = await apply(first.plan, target, first.applyOptions);
      expect(report.status).toBe("applied");
      expect(await authenticatorConfig(target)).toEqual([
        "pgrst.db_schemas=pgrst_no_exposed_schemas",
      ]);
      expect(await sqlOf(setLine)).toEqual([]);
      // the catalog check covers only the roles that existed before the load
      expect(
        await sqlOf(
          `${setLine}DO $$ BEGIN CREATE ROLE i476_app; END $$;\nALTER DATABASE postgres SET work_mem = '8MB';\n`,
        ),
      ).toEqual([]);

      // re-planning the export is a no-op
      const exported = await buildSchemaExport(target, {
        profile: supabaseProfile,
      });
      expect(
        exported.files
          .map((f) => f.sql)
          .join("\n")
          .match(/^ALTER ROLE .*$/gm),
      ).toEqual([
        `ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO 'pgrst_no_exposed_schemas';`,
      ]);
      const settingsFile = "_cluster/role_settings.sql";
      expect(exported.manifest.roleSettingsFiles).toEqual([settingsFile]);
      const syncExport = async (keep: (f: SqlFile) => boolean) =>
        (
          await planSchemaFiles(
            target,
            await freshShadow(),
            exported.files.filter(keep),
            {
              profile: supabaseProfile,
              manifest: exported.manifest,
              isolatedShadow: true,
            },
          )
        ).plan.actions.map((a) => a.sql);
      expect(await syncExport(() => true)).toEqual([]);
      expect(await syncExport((f) => f.name !== settingsFile)).toEqual([
        `ALTER ROLE "authenticator" RESET "pgrst.db_schemas"`,
      ]);

      expect(
        await sqlOf(
          `ALTER ROLE authenticator SET pgrst.db_schemas TO 'public, api';\n`,
        ),
      ).toEqual([
        `ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO 'public, api'`,
      ]);

      // a dir that neither declares role settings nor records them in its
      // manifest (exported before they were managed) leaves them unmanaged
      const warnings: string[] = [];
      const undeclared = await planSchemaFiles(
        target,
        await freshShadow(),
        files(),
        {
          profile: supabaseProfile,
          isolatedShadow: true,
          onWarning: (message) => warnings.push(message),
        },
      );
      expect({
        sql: undeclared.plan.actions.map((a) => a.sql),
        warnings: warnings.filter((w) => w.includes("role settings")),
      }).toEqual({
        sql: [],
        warnings: [
          `the target has role settings the profile manages (authenticator: pgrst.db_schemas), but the files declare none ` +
            `and the export manifest does not record them, so they are left unmanaged: the plan neither sets nor resets them. ` +
            `Re-export with the current pg-delta to manage them.`,
        ],
      });

      // any other ALTER ROLE is refused by the catalog comparison after the
      // load (the image already sets a statement_timeout on authenticator)
      expect(
        await failureOf(
          sync(`ALTER ROLE authenticator SET statement_timeout = '5s';\n`),
        ),
      ).toMatch(
        /changed cluster-level role state[^]*: role "authenticator" setting "statement_timeout"\./,
      );
      expect(
        await failureOf(
          sync(
            `ALTER ROLE authenticator IN DATABASE postgres SET pgrst.db_schemas = 'api';\n`,
          ),
        ),
      ).toMatch(
        /: role "authenticator" setting "pgrst.db_schemas" in database "postgres"\./,
      );

      // a membership between roles that existed before the load is role state
      // too; ALTER GROUP … ADD USER is labelled ALTER ROLE and must not vanish
      await shadowAdmin.query(`CREATE ROLE i476_grp; CREATE ROLE i476_member`);
      expect(
        await failureOf(sync(`ALTER GROUP i476_grp ADD USER i476_member;\n`)),
      ).toMatch(/: membership of "i476_member" in role "i476_grp"/);

      // a co-located shadow shares the target's roles, so a hand-written line
      // is refused
      const coLocated = await provisionCoLocatedShadow(
        targetServer.postgresConnectionUri(),
      );
      try {
        expect(
          await failureOf(
            planSchemaFiles(target, open(coLocated.url), files(setLine), {
              profile: supabaseProfile,
              seedAssumedSchemas: true,
            }),
          ),
        ).toMatch(/roles\.sql: ALTER ROLE[^]*only against an isolated shadow/);
        // a shadow that is not isolated leaves the settings unmanaged: no
        // RESET of the target's value, one warning. The export's own
        // role-settings file is skipped instead of refused.
        const unmanaged = async (
          shadow: pg.Pool,
          coLocatedShadow: boolean,
          exportDir?: typeof exported,
        ) => {
          const warnings: string[] = [];
          const planned = await planSchemaFiles(
            target,
            shadow,
            exportDir?.files ?? files(),
            {
              profile: supabaseProfile,
              ...(exportDir !== undefined
                ? { manifest: exportDir.manifest }
                : {}),
              seedAssumedSchemas: coLocatedShadow,
              onWarning: (message) => warnings.push(message),
            },
          );
          return {
            sql: planned.plan.actions.map((a) => a.sql),
            warnings: warnings.filter((w) => w.includes("role settings")),
          };
        };
        const leftUnmanaged =
          `the target has role settings the profile manages (authenticator: pgrst.db_schemas), but the shadow is not isolated, ` +
          `so they are left unmanaged: the plan neither sets nor resets them. Plan against an isolated shadow (isolatedShadow: true) to manage them.`;
        expect(await unmanaged(await freshShadow(), false)).toEqual({
          sql: [],
          warnings: [leftUnmanaged],
        });
        expect(await unmanaged(open(coLocated.url), true, exported)).toEqual({
          sql: [],
          warnings: [
            `skipped ${settingsFile}: it holds the export's role settings (ALTER ROLE … SET), which database scope manages only against an isolated shadow.`,
            leftUnmanaged,
          ],
        });
      } finally {
        await coLocated.cleanup();
      }
      expect(await authenticatorConfig(target)).toEqual([
        "pgrst.db_schemas=pgrst_no_exposed_schemas",
      ]);
    }, 300_000);
  },
);
