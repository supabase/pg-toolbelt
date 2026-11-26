/**
 * Declarative flow: objects the target gives to another role, synced from files
 * that leave them with the default owner, must return to the default owner and
 * the next `schema apply` must plan nothing. Today the owner is never changed
 * back (the export leaves the default owner implicit), only the ACLs derived
 * from it are rewritten, and the same REVOKE is planned on every run.
 *
 * https://github.com/supabase/pg-toolbelt/issues/631
 *
 * Drives the real CLI (subprocess). Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedCluster, type TestDb } from "./containers.ts";

const PKG_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CLI = join(PKG_DIR, "src/cli/main.ts");

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: PKG_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

const dbs: TestDb[] = [];
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  const cluster = await sharedCluster();
  await cluster.adminPool
    .query(`DROP ROLE IF EXISTS ephyra_writer_631`)
    .catch(() => {});
});

describe("schema apply: object owned by another role, desired with the default owner", () => {
  // test.failing: the owner is never changed back and the REVOKEs re-plan forever.
  test.failing(
    "returns the schema and table to the default owner, then re-plans nothing",
    async () => {
      const cluster = await sharedCluster();
      await cluster.adminPool
        .query(`CREATE ROLE ephyra_writer_631 NOLOGIN`)
        .catch(() => {});
      const desired = await cluster.createDb("owner_back_desired");
      const target = await cluster.createDb("owner_back_target");
      dbs.push(desired, target);
      await desired.pool.query(`
      CREATE SCHEMA app;
      CREATE TABLE t (id int);
    `);
      await target.pool.query(`
      CREATE SCHEMA app;
      ALTER SCHEMA app OWNER TO ephyra_writer_631;
      CREATE TABLE t (id int);
      ALTER TABLE t OWNER TO ephyra_writer_631;
    `);

      const dir = mkdtempSync(join(tmpdir(), "owner-back-"));
      dirs.push(dir);
      const exported = await runCli([
        "schema",
        "export",
        "--source",
        desired.uri,
        "--out-dir",
        dir,
        "--layout",
        "grouped",
      ]);
      expect(exported.exitCode).toBe(0);

      const applied = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--force",
      ]);
      expect({ code: applied.exitCode, stderr: applied.stderr }).toMatchObject({
        code: 0,
      });

      const owners = (
        await target.pool.query<{ obj: string; owner: string }>(`
        SELECT 'schema' AS obj, pg_get_userbyid(nspowner) AS owner
          FROM pg_namespace WHERE nspname = 'app'
        UNION ALL
        SELECT 'table', pg_get_userbyid(relowner)
          FROM pg_class WHERE oid = 'public.t'::regclass
        ORDER BY 1`)
      ).rows;
      const datdba = (
        await target.pool.query<{ o: string }>(
          `SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = current_database()`,
        )
      ).rows[0]!.o;
      expect(owners).toEqual([
        { obj: "schema", owner: datdba },
        { obj: "table", owner: datdba },
      ]);

      const rerun = await runCli([
        "schema",
        "apply",
        "--dir",
        dir,
        "--target",
        target.uri,
        "--dry-run",
      ]);
      expect(rerun.stdout + rerun.stderr).not.toMatch(/REVOKE ALL ON/);
      expect(rerun.stdout + rerun.stderr).toMatch(/no schema changes/i);
    },
    300_000,
  );
});
