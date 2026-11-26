// Reproduce drafts 16 (Supabase) and 17 (stock) through the pgdelta CLI.
import {
  sharedCluster,
  startStandaloneSupabase,
} from "../../../packages/pg-delta/tests/containers.ts";
import { applySupabaseBaseInit } from "../../../packages/pg-delta/tests/supabase-base-init.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const pg = createRequire(
  import.meta.resolve("../../../packages/pg-delta/package.json"),
)("pg");
const MAIN = new URL(
  "../../../packages/pg-delta/src/cli/main.ts",
  import.meta.url,
).pathname;
const run = (args: string[]) => {
  const p = Bun.spawnSync(["bun", MAIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (p.stdout.toString() + p.stderr.toString()).trim();
  console.log(
    `$ pgdelta ${args.map((a) => (a.startsWith("postgres") ? "<url>" : a.includes("/T/") || a.includes("/tmp") ? "<dir>" : a)).join(" ")}\n${out}\n(exit ${p.exitCode})\n`,
  );
};
const which = process.argv[2];
if (which === "stock") {
  const c = await sharedCluster();
  await c.adminPool.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eph_writer') THEN CREATE ROLE eph_writer; END IF; END $$`,
  );
  const live = await c.createDb("cli_live");
  const want = await c.createDb("cli_want");
  await live.pool.query(
    `CREATE SCHEMA app; ALTER SCHEMA app OWNER TO eph_writer; CREATE TABLE t (id int); ALTER TABLE t OWNER TO eph_writer;`,
  );
  await want.pool.query(`CREATE SCHEMA app; CREATE TABLE t (id int);`);
  const dir = mkdtempSync(join(tmpdir(), "pgd-"));
  run([
    "schema",
    "export",
    "--source",
    want.uri,
    "--out-dir",
    dir,
    "--layout",
    "grouped",
  ]);
  run(["schema", "apply", "--dir", dir, "--target", live.uri, "--force"]);
  run(["schema", "apply", "--dir", dir, "--target", live.uri, "--dry-run"]);
  const r = await live.pool.query(
    `SELECT 'app' n, pg_get_userbyid(nspowner) o FROM pg_namespace WHERE nspname='app' UNION ALL SELECT 't', pg_get_userbyid(relowner) FROM pg_class WHERE relname='t'`,
  );
  console.log("owners after apply:", r.rows);
} else {
  const s = await startStandaloneSupabase();
  const boot = new pg.Pool({
    connectionString: s.connectionUri("postgres"),
    max: 1,
  });
  if (!process.env.NO_BASE_INIT) await applySupabaseBaseInit(boot);
  console.log(
    "public function defaults:",
    (
      await boot.query(
        `select defaclacl::text a from pg_default_acl where pg_get_userbyid(defaclrole)='postgres' and defaclnamespace='public'::regnamespace and defaclobjtype='f'`,
      )
    ).rows,
  );
  await boot.end();
  const url = s.postgresConnectionUri("postgres");
  const dir = mkdtempSync(join(tmpdir(), "pgd-"));
  run([
    "schema",
    "export",
    "--source",
    url,
    "--out-dir",
    dir,
    "--layout",
    "grouped",
    "--profile",
    "supabase",
  ]);
  run([
    "schema",
    "apply",
    "--dir",
    dir,
    "--target",
    url,
    "--profile",
    "supabase",
    "--dry-run",
  ]);
}
process.exit(0);
