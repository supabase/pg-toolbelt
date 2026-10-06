/**
 * OrioleDB Supabase image (`ORIOLEDB_IMAGE`). The server sets
 * `default_table_access_method = orioledb`, so a plain CREATE TABLE in a
 * database without the `orioledb` extension fails with `access method
 * "orioledb" does not exist` — including the co-located shadow, which is a
 * fresh `TEMPLATE template0` database. The Supabase profile assumes `orioledb`
 * (reference-only), so the shadow seed installs it before replaying the
 * platform tables that use it, and the diff never creates or drops it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdSchemaApply } from "../src/cli/commands/schema.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import {
  orioledbCluster,
  runSupabaseBareTests,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

/** A stand-in Supabase target on the OrioleDB cluster: the extension in
 *  `extensions` (as the image's `postgres` database has it) and a platform
 *  `auth.users`, which takes the server-default `orioledb` access method. */
async function orioledbTarget(name: string): Promise<TestDb> {
  const cluster = await orioledbCluster();
  const target = await cluster.createDb(name);
  dbs.push(target);
  await cluster.adminPool.query(
    `ALTER DATABASE "${target.name}" OWNER TO postgres`,
  );
  await target.pool.query(
    `CREATE SCHEMA extensions;\n` +
      `CREATE EXTENSION orioledb SCHEMA extensions;\n` +
      `CREATE SCHEMA auth;\n` +
      `CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);\n` +
      `GRANT ALL ON TABLE auth.users TO postgres;\n`,
  );
  return target;
}

describe.skipIf(!runSupabaseBareTests)("orioledb image", () => {
  test("a table depends on the extension providing its access method", async () => {
    const target = await orioledbTarget("orioledb_am_edge");
    const { factBase } = await extract(target.pool);
    const edges = factBase.edges
      .filter((e) => e.kind === "depends")
      .map((e) => `${encodeId(e.from)} -> ${encodeId(e.to)}`);
    expect(edges).toContain("table:auth.users -> extension:orioledb");
  }, 240_000);

  test("co-located schema apply seeds orioledb before the platform tables", async () => {
    const target = await orioledbTarget("orioledb_shadow_tgt");

    const dir = join(tmpdir(), `pg-delta-orioledb-shadow-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "01_profiles.sql"),
      `CREATE TABLE public.profiles (id uuid PRIMARY KEY, name text);\n`,
    );
    writeFileSync(
      join(dir, "02_fn.sql"),
      `CREATE FUNCTION public.handle_new_user() RETURNS trigger\n` +
        `  LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;\n`,
    );
    writeFileSync(
      join(dir, "03_trigger.sql"),
      `CREATE TRIGGER on_auth_user_created\n` +
        `  AFTER INSERT ON auth.users\n` +
        `  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();\n`,
    );

    await cmdSchemaApply([
      "--dir",
      dir,
      "--target",
      target.postgresUri!,
      "--renames",
      "off",
      "--profile",
      "supabase",
    ]);

    const { rows } = await target.pool.query<{
      trigger: number;
      am: string | null;
      ext: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM pg_trigger
           WHERE tgname = 'on_auth_user_created'
             AND tgrelid = 'auth.users'::regclass) AS trigger,
         (SELECT a.amname FROM pg_class c JOIN pg_am a ON a.oid = c.relam
           WHERE c.oid = to_regclass('public.profiles')) AS am,
         (SELECT count(*)::int FROM pg_extension
           WHERE extname = 'orioledb') AS ext`,
    );
    expect(rows[0]).toEqual({ trigger: 1, am: "orioledb", ext: 1 });
  }, 240_000);
});
