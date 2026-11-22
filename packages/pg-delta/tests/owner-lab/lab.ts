/**
 * owner-lab: run a scenario (a.sql -> b.sql) END TO END as a NON-superuser
 * applier on real Postgres, classify the outcome, judge it (verdict) and compare
 * raw catalogs by name (drift the fact model cannot see), data preservation,
 * session state and failure atomicity.
 *
 *   cd packages/pg-delta
 *   bun tests/owner-lab/lab.ts --image postgres:17-alpine --suite --direction both
 *   bun tests/owner-lab/lab.ts --image postgres:17-alpine <scenarioDir>...
 *
 * Flags: --json <file>  --verbose  --direction forward|reverse|both
 *        --applier createrole|superuser
 *        --login direct|stepdown   (stepdown: log in as `lab_login`, then
 *                                   SET SESSION ROLE <applier>, like the CLI)
 *        --via apply|script        (script: renderApplyScript, ONE simple query)
 *        --suite | --all | --corpus [--filter <substr>]  --shard i/n
 *        --record-baseline <f.jsonl>  --compare-baseline <f.jsonl>
 *        --supabase  (two fresh supabase/postgres containers PER RUN; applier =
 *                     `postgres`, desired/source in database `postgres`, plan
 *                     through the supabase integration profile; --image must be
 *                     a supabase image)
 * The lab imports nothing PoC-specific, so it runs unchanged on a source tree
 * without the applier-authorization work. See README.md.
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import pg from "pg";
import { apply, segmentActions } from "../../src/apply/apply.ts";
import { extract } from "../../src/extract/extract.ts";
import { planSettled } from "../../src/frontends/settle-desired.ts";
import { renderApplyScript } from "../../src/frontends/render-apply-script.ts";
import { plan, type Plan } from "../../src/plan/plan.ts";
import {
  resolveProfile,
  supabaseProfile,
} from "../../src/integrations/index.ts";
import type { ResolvedProfile } from "../../src/integrations/index.ts";
import type { RenameMode } from "../../src/plan/renames.ts";
import { probeApplierCapability } from "../../src/policy/capability.ts";
import { GenericContainer, Wait } from "testcontainers";
import type { Cluster as ClusterT } from "../containers.ts";
import {
  baselineKey,
  computeVerdict,
  normalizeRefLines,
  refineVerdict,
  resolveIdeal,
  splitSqlStatements,
  statementDiff,
  type Ideal,
  type IdealMeta,
} from "./verdict.ts";

// ── args ─────────────────────────────────────────────────────────────────────
interface Args {
  image: string;
  dirs: string[];
  all: boolean;
  suite: boolean;
  corpus: boolean;
  filter?: string;
  json?: string;
  verbose: boolean;
  direction: "forward" | "reverse" | "both";
  applier: "createrole" | "superuser";
  login: "direct" | "stepdown";
  via: "apply" | "script";
  /** --stepdown-setup: with --login stepdown, also run a.sql/b.sql over stepdown connections */
  stepdownSetup: boolean;
  /** --no-reference: skip the superuser reference run */
  reference: boolean;
  supabase: boolean;
  /** --no-profile (with --supabase): plan with the raw probed capability only */
  noProfile: boolean;
  shard?: { i: number; n: number };
  recordBaseline?: string;
  compareBaseline?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    image: process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
    dirs: [],
    all: false,
    suite: false,
    corpus: false,
    verbose: false,
    direction: "forward",
    applier: "createrole",
    login: "direct",
    via: "apply",
    stepdownSetup: false,
    reference: true,
    supabase: false,
    noProfile: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--image") args.image = next();
    else if (a === "--all") args.all = true;
    else if (a === "--suite") args.suite = true;
    else if (a === "--corpus") args.corpus = true;
    else if (a === "--filter") args.filter = next();
    else if (a === "--json") args.json = next();
    else if (a === "--record-baseline") args.recordBaseline = next();
    else if (a === "--compare-baseline") args.compareBaseline = next();
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--supabase") args.supabase = true;
    else if (a === "--stepdown-setup") args.stepdownSetup = true;
    else if (a === "--no-reference") args.reference = false;
    else if (a === "--no-profile") args.noProfile = true;
    else if (a === "--shard") {
      const m = /^(\d+)\/(\d+)$/.exec(next());
      if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2]))
        throw new Error("bad --shard (want i/n, 1-based)");
      args.shard = { i: Number(m[1]), n: Number(m[2]) };
    } else if (a === "--direction") {
      const v = next();
      if (v !== "forward" && v !== "reverse" && v !== "both")
        throw new Error(`bad --direction ${v}`);
      args.direction = v;
    } else if (a === "--applier") {
      const v = next();
      if (v !== "createrole" && v !== "superuser")
        throw new Error(`bad --applier ${v}`);
      args.applier = v;
    } else if (a === "--login") {
      const v = next();
      if (v !== "direct" && v !== "stepdown")
        throw new Error(`bad --login ${v}`);
      args.login = v;
    } else if (a === "--via") {
      const v = next();
      if (v !== "apply" && v !== "script") throw new Error(`bad --via ${v}`);
      args.via = v;
    } else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else args.dirs.push(a);
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));
// containers.ts reads PGDELTA_TEST_IMAGE at module load: set it before the
// dynamic import below.
process.env["PGDELTA_TEST_IMAGE"] = ARGS.image;
const { isolatedClusterPair, stopAllClusters, Cluster } =
  await import("../containers.ts");
type Cluster = ClusterT;

// ── scenarios ────────────────────────────────────────────────────────────────
interface Meta extends IdealMeta {
  minVersion?: number;
  maxVersion?: number;
  tags?: string[];
  /** passed to plan() as `params` (e.g. `{ "concurrentIndexes": true }`) */
  planParams?: Record<string, unknown>;
  applierInherit?: boolean;
  dbOwner?: "applier" | "superuser";
  executeAs?: "applier" | "superuser";
  notes?: string;
  /** corpus meta passthroughs */
  renames?: RenameMode;
  settleDesired?: boolean;
}
interface Scenario {
  /** path relative to tests/owner-lab (baseline key, display) */
  name: string;
  a: string;
  b: string;
  preA?: string;
  preB?: string;
  postA?: string;
  postB?: string;
  seedA?: string;
  seedB?: string;
  meta: Meta;
}

function readOpt(dir: string, file: string): string | undefined {
  const p = join(dir, file);
  return existsSync(p) ? readFileSync(p, "utf8") : undefined;
}

function loadScenario(dir: string): Scenario {
  const abs = resolve(dir);
  const metaText = readOpt(abs, "meta.json");
  const a = readOpt(abs, "a.sql");
  const b = readOpt(abs, "b.sql");
  if (a === undefined || b === undefined)
    throw new Error(`${abs}: a.sql and b.sql are required`);
  const s: Scenario = {
    name: relative(HERE, abs),
    a,
    b,
    meta: metaText ? (JSON.parse(metaText) as Meta) : {},
  };
  for (const [k, f] of [
    ["preA", "pre-a.sql"],
    ["preB", "pre-b.sql"],
    ["postA", "post-a.sql"],
    ["postB", "post-b.sql"],
    ["seedA", "seed-a.sql"],
    ["seedB", "seed-b.sql"],
  ] as const) {
    const v = readOpt(abs, f);
    if (v !== undefined) s[k] = v;
  }
  return s;
}

const HERE = import.meta.dir;
function listDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name))
    .sort();
}
/** Scenario dirs under `root`: a dir holding a.sql, else recurse. */
function listScenarioDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const d of listDirs(root)) {
    if (existsSync(join(d, "a.sql"))) out.push(d);
    else out.push(...listScenarioDirs(d));
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const APPLIER = "lab_applier";
const APPLIER_PW = "lab";
const SRC_DB = "lab_src";
const DST_DB = "lab_dst";

const LOGIN = "lab_login";
const LOGIN_PW = "lab";

/** A client that, once connected, runs `SET SESSION ROLE <role>` before the
 *  pool hands it out (what the Supabase CLI does after login). */
function stepdownClient(role: string): typeof pg.Client {
  return class extends pg.Client {
    // pg.Pool calls connect(cb); direct callers use the promise form.
    // oxlint-disable-next-line typescript/no-explicit-any
    override connect(cb?: any): any {
      const init = async (): Promise<void> => {
        await super.connect();
        await this.query(`SET SESSION ROLE ${q(role)}`);
      };
      if (cb === undefined) return init();
      init().then(
        () => cb(),
        (e) => cb(e),
      );
      return undefined;
    }
  };
}

function mkPool(
  uri: string,
  opts: { max?: number; stepdownTo?: string } = {},
): pg.Pool {
  const p = new pg.Pool({
    connectionString: uri,
    max: opts.max ?? 4,
    idleTimeoutMillis: 0,
    ...(opts.stepdownTo !== undefined
      ? { Client: stepdownClient(opts.stepdownTo) as never }
      : {}),
  });
  p.on("error", () => {});
  return p;
}
function uriAs(base: string, user: string, password: string): string {
  const u = new URL(base);
  u.username = user;
  u.password = password;
  return u.toString();
}
const q = (s: string): string => `"${s.replaceAll('"', '""')}"`;

function errInfo(e: unknown): {
  message: string;
  name: string;
  code?: string;
  stack?: string;
} {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return {
      message: e.message,
      name: e.name,
      ...(typeof code === "string" ? { code } : {}),
      ...(e.stack ? { stack: e.stack } : {}),
    };
  }
  return { message: String(e), name: "non-error" };
}

class SetupError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(message);
  }
}

async function runSql(
  pool: pg.Pool,
  sql: string | undefined,
  file: string,
): Promise<void> {
  if (sql === undefined || sql.trim() === "") return;
  try {
    await pool.query(sql);
  } catch (e) {
    const info = errInfo(e);
    const pos = Number((e as { position?: unknown }).position);
    let near = "";
    if (Number.isFinite(pos) && pos > 0)
      near = ` (near: ${JSON.stringify(sql.slice(Math.max(0, pos - 1), pos + 60))})`;
    throw new SetupError(file, `${info.message}${near}`);
  }
}

// ── supabase clusters ────────────────────────────────────────────────────────
/** A fresh supabase/postgres container, provisioned like containers.ts's
 *  `startSupabaseCluster` (the module keeps it private and shared). `postgres`
 *  is exposed the way Cloud does: NOSUPERUSER, member of
 *  `supabase_privileged_role`. `builtinRoles` is the role set at boot. */
interface SupaCluster {
  cluster: Cluster;
  builtinRoles: string[];
}
const supaLive = new Set<Cluster>();

async function startSupabase(image: string): Promise<SupaCluster> {
  const container = await new GenericContainer(image)
    .withEnvironment({
      POSTGRES_USER: "supabase_admin",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "postgres",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(180_000)
    .withTmpFs({ "/var/lib/postgresql/data": "rw,noexec,nosuid,size=512m" })
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const uriFor = (db: string) =>
    `postgres://supabase_admin:postgres@${host}:${port}/${db}`;
  const postgresUriFor = (db: string) =>
    `postgres://postgres:postgres@${host}:${port}/${db}`;
  const adminPool = new pg.Pool({
    connectionString: uriFor("postgres"),
    max: 3,
  });
  adminPool.on("error", () => {});
  await adminPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_privileged_role') THEN
        CREATE ROLE supabase_privileged_role;
      END IF;
    END $$;`);
  await adminPool.query("GRANT supabase_privileged_role TO postgres");
  await adminPool.query(
    "ALTER ROLE postgres WITH LOGIN NOSUPERUSER PASSWORD 'postgres'",
  );
  const cluster = new Cluster(container, adminPool, uriFor, postgresUriFor);
  supaLive.add(cluster);
  const roles = await adminPool.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles`,
  );
  return { cluster, builtinRoles: roles.rows.map((r) => r.rolname) };
}

async function stopSupabase(c: Cluster): Promise<void> {
  supaLive.delete(c);
  await c.stop().catch(() => {});
}

/** Supabase platform schemas excluded from the catalog comparison (plus pg_*
 *  and information_schema). `public` is included. */
const SUPA_PLATFORM_SCHEMAS = [
  "auth",
  "storage",
  "realtime",
  "extensions",
  "graphql",
  "graphql_public",
  "vault",
  "pgbouncer",
  "pgsodium",
  "pgsodium_masks",
  "net",
  "cron",
  "supabase_functions",
  "supabase_migrations",
  "_realtime",
  "_analytics",
];
const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`;

// ── catalog truth ────────────────────────────────────────────────────────────
function nsFilterFor(col: string, supa: boolean): string {
  return supa
    ? `${col} NOT IN (${SUPA_PLATFORM_SCHEMAS.map(lit).join(",")}, 'information_schema')
    AND ${col} NOT LIKE 'pg\\_%'`
    : `${col} NOT IN ('pg_catalog','information_schema')
    AND ${col} NOT LIKE 'pg\\_toast%' AND ${col} NOT LIKE 'pg\\_temp%'`;
}

function dbCatalogSql(supa: boolean): string {
  const nsFilter = nsFilterFor("nspname", supa);
  return `
WITH ns AS (
  SELECT oid, nspname FROM pg_namespace
  WHERE ${nsFilter}
),
objs AS (
  SELECT 'rel[' || c.relkind::text || ']' AS kind, ns.nspname || '.' || c.relname AS nm, c.relowner AS owner, c.relacl AS acl,
         CASE WHEN c.relkind IN ('r','v','m','p','f') THEN 'r' WHEN c.relkind = 'S' THEN 's' END AS aclt
    FROM pg_class c JOIN ns ON ns.oid = c.relnamespace
  UNION ALL
  SELECT 'proc[' || p.prokind::text || ']', p.oid::regprocedure::text, p.proowner, p.proacl, 'f'
    FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace
  UNION ALL
  SELECT 'type[' || t.typtype::text || ']', ns.nspname || '.' || t.typname, t.typowner, t.typacl, 'T'
    FROM pg_type t JOIN ns ON ns.oid = t.typnamespace
   WHERE t.typcategory <> 'A'
     AND NOT (t.typtype = 'c' AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind <> 'c'))
  UNION ALL
  SELECT 'schema', nspname, nspowner, nspacl, 'n' FROM pg_namespace WHERE oid IN (SELECT oid FROM ns)
  UNION ALL
  SELECT 'publication', pubname, pubowner, NULL, NULL FROM pg_publication
  UNION ALL
  SELECT 'event trigger', evtname, evtowner, NULL, NULL FROM pg_event_trigger
  UNION ALL
  SELECT 'fdw', fdwname, fdwowner, fdwacl, 'F' FROM pg_foreign_data_wrapper
  UNION ALL
  SELECT 'server', srvname, srvowner, srvacl, 'S' FROM pg_foreign_server
  UNION ALL
  SELECT 'extension', extname, extowner, NULL, NULL FROM pg_extension
  UNION ALL
  SELECT 'language', lanname, lanowner, lanacl, 'l' FROM pg_language WHERE lanname NOT IN ('internal','c','sql')
  UNION ALL
  SELECT 'database', '<db>', datdba, datacl, 'd' FROM pg_database WHERE datname = current_database()
)
SELECT 'owner ' || kind || ' ' || nm || ' -> ' || pg_get_userbyid(owner) AS line FROM objs
UNION ALL
SELECT 'acl ' || kind || ' ' || nm || ' ' || a::text FROM objs, LATERAL unnest(coalesce(acl, CASE WHEN aclt IS NOT NULL THEN acldefault(aclt::"char", owner) END)) AS a
UNION ALL
SELECT 'colacl ' || ns.nspname || '.' || c.relname || '.' || at.attname || ' ' || a::text
  FROM pg_attribute at
  JOIN pg_class c ON c.oid = at.attrelid
  JOIN ns ON ns.oid = c.relnamespace,
  LATERAL unnest(at.attacl) AS a
 WHERE at.attnum > 0 AND NOT at.attisdropped AND at.attacl IS NOT NULL
UNION ALL
SELECT 'defacl ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '-') || ' ' || d.defaclobjtype::text || ' ' || a::text
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
  LATERAL unnest(d.defaclacl) AS a`;
}

/** PG16+: one line per (role, member) with the EFFECTIVE INHERIT / SET (any
 *  row, any grantor, self-grants included); per-grantor lines carry ADMIN. */
function memberUseSql(where: string): string {
  return `SELECT 'memberuse ' || pg_get_userbyid(m.roleid) || ' <- ' || pg_get_userbyid(m.member)
              || ' inherit=' || bool_or(m.inherit_option)::text || ' set=' || bool_or(m.set_option)::text
           FROM pg_auth_members m
          WHERE ${where}
          GROUP BY m.roleid, m.member`;
}

function clusterCatalogSql(pgMajor: number, builtin?: string[]): string {
  if (builtin !== undefined) return supaClusterCatalogSql(pgMajor, builtin);
  const notBuiltin = `(pg_get_userbyid(m.roleid) NOT LIKE 'pg\\_%' OR pg_get_userbyid(m.member) NOT LIKE 'pg\\_%')`;
  const members =
    pgMajor >= 16
      ? `SELECT 'member ' || pg_get_userbyid(m.roleid) || ' <- ' || pg_get_userbyid(m.member)
              || ' admin=' || m.admin_option::text
              || ' grantor=' || pg_get_userbyid(m.grantor)
           FROM pg_auth_members m
          WHERE ${notBuiltin}
            AND m.grantor <> m.member
         UNION ALL
         ${memberUseSql(notBuiltin)}`
      : `SELECT 'member ' || pg_get_userbyid(m.roleid) || ' <- ' || pg_get_userbyid(m.member)
              || ' admin=' || m.admin_option::text
           FROM pg_auth_members m
          WHERE pg_get_userbyid(m.roleid) NOT LIKE 'pg\\_%' OR pg_get_userbyid(m.member) NOT LIKE 'pg\\_%'`;
  return `
${members}
UNION ALL
SELECT 'role ' || rolname || ' super=' || rolsuper::text || ' inherit=' || rolinherit::text
    || ' createrole=' || rolcreaterole::text || ' createdb=' || rolcreatedb::text
    || ' login=' || rolcanlogin::text || ' repl=' || rolreplication::text || ' bypassrls=' || rolbypassrls::text
    || ' config=' || coalesce((SELECT array_agg(c ORDER BY c) FROM unnest(rolconfig) AS c)::text, '')
  FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND oid <> 10`;
}

/** Supabase: members rows where either side is not a boot-time role, plus every
 *  row whose member is `postgres`; role attributes for non-boot roles and
 *  `postgres` itself. */
function supaClusterCatalogSql(pgMajor: number, builtin: string[]): string {
  const bl = `ARRAY[${builtin.map(lit).join(",")}]::text[]`;
  const cols =
    pgMajor >= 16
      ? `' admin=' || m.admin_option::text
              || ' grantor=' || pg_get_userbyid(m.grantor)`
      : `' admin=' || m.admin_option::text`;
  const kept = `(NOT (pg_get_userbyid(m.roleid) = ANY(${bl}))
    OR NOT (pg_get_userbyid(m.member) = ANY(${bl}))
    OR pg_get_userbyid(m.member) = 'postgres')`;
  return `
SELECT 'member ' || pg_get_userbyid(m.roleid) || ' <- ' || pg_get_userbyid(m.member) || ${cols}
  FROM pg_auth_members m
 WHERE ${kept}
   ${pgMajor >= 16 ? "AND m.grantor <> m.member" : ""}
UNION ALL
${pgMajor >= 16 ? `${memberUseSql(kept)}\nUNION ALL` : ""}
SELECT 'role ' || rolname || ' super=' || rolsuper::text || ' inherit=' || rolinherit::text
    || ' createrole=' || rolcreaterole::text || ' createdb=' || rolcreatedb::text
    || ' login=' || rolcanlogin::text || ' repl=' || rolreplication::text || ' bypassrls=' || rolbypassrls::text
    || ' config=' || coalesce((SELECT array_agg(c ORDER BY c) FROM unnest(rolconfig) AS c)::text, '')
  FROM pg_roles WHERE NOT (rolname = ANY(${bl})) OR rolname = 'postgres'`;
}

async function catalogLines(
  adminDbPool: pg.Pool,
  pgMajor: number,
  builtin?: string[],
): Promise<string[]> {
  const [db, cl] = await Promise.all([
    adminDbPool.query<{ line: string }>(dbCatalogSql(builtin !== undefined)),
    adminDbPool.query<{ line?: string }>(
      `SELECT l AS line FROM (${clusterCatalogSql(pgMajor, builtin)}) AS t(l)`,
    ),
  ]);
  return [...db.rows, ...cl.rows]
    .map((r) => r.line ?? "")
    .filter((l) => l !== "")
    .sort();
}

function multisetDiff(
  desired: string[],
  result: string[],
): { onlyDesired: string[]; onlyResult: string[] } {
  const count = new Map<string, number>();
  for (const l of desired) count.set(l, (count.get(l) ?? 0) + 1);
  const onlyResult: string[] = [];
  for (const l of result) {
    const c = count.get(l) ?? 0;
    if (c > 0) count.set(l, c - 1);
    else onlyResult.push(l);
  }
  const onlyDesired: string[] = [];
  for (const [l, c] of count) for (let i = 0; i < c; i++) onlyDesired.push(l);
  return { onlyDesired: onlyDesired.sort(), onlyResult: onlyResult.sort() };
}

// ── data preservation ───────────────────────────────────────────────────────
interface TableSnap {
  cols: string;
  n: number;
  md5: string;
}

async function listTables(
  pool: pg.Pool,
  supa: boolean,
): Promise<{ schema: string; name: string; cols: string }[]> {
  const r = await pool.query<{ schema: string; name: string; cols: string }>(`
    SELECT n.nspname AS schema, c.relname AS name,
           coalesce((SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
                       FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '') AS cols
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p') AND ${nsFilterFor("n.nspname", supa)}
     ORDER BY 1, 2`);
  return r.rows;
}

/** As SUPERUSER: one default row per table that accepts it, then the
 *  scenario's own seed file. */
async function seedData(
  pool: pg.Pool,
  supa: boolean,
  seedSql: string | undefined,
  seedFile: string,
): Promise<void> {
  for (const t of await listTables(pool, supa))
    await pool
      .query(`INSERT INTO ${q(t.schema)}.${q(t.name)} DEFAULT VALUES`)
      .catch(() => {});
  await runSql(pool, seedSql, seedFile);
}

async function snapTables(
  pool: pg.Pool,
  supa: boolean,
): Promise<Map<string, TableSnap>> {
  const out = new Map<string, TableSnap>();
  for (const t of await listTables(pool, supa)) {
    try {
      const r = await pool.query<{ n: number; h: string }>(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) AS h
           FROM ${q(t.schema)}.${q(t.name)} AS t`,
      );
      out.set(`${t.schema}.${t.name}`, {
        cols: t.cols,
        n: r.rows[0]!.n,
        md5: r.rows[0]!.h,
      });
    } catch {
      // unreadable table: not recorded
    }
  }
  return out;
}

function dataLoss(
  before: Map<string, TableSnap>,
  after: Map<string, TableSnap>,
  desiredTables: Set<string>,
): string[] {
  const lost: string[] = [];
  for (const [key, b] of before) {
    if (b.n < 1 || !desiredTables.has(key)) continue;
    const a = after.get(key);
    if (a === undefined)
      lost.push(`${key} (missing from result, had ${b.n} row(s))`);
    else if (a.n !== b.n) lost.push(`${key} (rows ${b.n} -> ${a.n})`);
    else if (a.cols === b.cols && a.md5 !== b.md5)
      lost.push(`${key} (row content changed)`);
  }
  return lost;
}

// ── session state ───────────────────────────────────────────────────────────
interface Queryable {
  query: (sql: string) => Promise<{ rows: Record<string, string>[] }>;
}
async function sessionState(c: Queryable): Promise<string> {
  const r = await c.query(
    `SELECT current_user AS cu, session_user AS su, current_setting('role') AS role`,
  );
  const x = r.rows[0]!;
  return `current_user=${x["cu"]} session_user=${x["su"]} role=${x["role"]}`;
}
async function sessionStateSafe(c: Queryable): Promise<string> {
  try {
    return await sessionState(c);
  } catch (e) {
    return `unreadable: ${errInfo(e).message}`;
  }
}

/** Typed capability / identity refusals, detected structurally so the lab
 *  runs on trees that do not have those classes. */
function isTypedRefusal(info: { name: string; code?: string }): boolean {
  return (
    info.name === "CapabilityError" ||
    info.name === "ApplierIdentityError" ||
    info.code === "capability_blocked" ||
    info.code === "applier_identity"
  );
}

// ── run ──────────────────────────────────────────────────────────────────────
type Direction = "forward" | "reverse";

interface RunRecord {
  image: string;
  scenario: string;
  direction: Direction;
  /** role name the applier connections use (display) */
  applier: string;
  /** --applier value (baseline key) */
  applierMode: string;
  login: string;
  via: string;
  supabase: boolean;
  outcome: string;
  detail: string;
  verdict: string;
  /** DATA_LOSS | ROLE_LEFT | MEMBER_USE | PLAN_CHANGED */
  flags: string[];
  /** MEMBER_USE: roles whose effective membership of the applier differs */
  memberUse?: string[];
  /** verdict before a baseline REGRESSION override */
  rawVerdict?: string;
  baseline?: "no-baseline" | "compared";
  baselineVerdict?: string;
  ideal: Ideal;
  tags: string[];
  /** transaction segments in the plan */
  segments: number;
  /** APPLY_FAIL only: did the source catalog stay as it was? */
  failClean?: "clean" | "dirty";
  /** createrole modes: the superuser reference run (same diff, no capability) */
  reference?: {
    outcome: string;
    detail: string;
    dataLoss: string[];
    plan: string[];
    /** main's deviations from desired are all also in the reference's */
    sameResult: boolean;
    strictlyIdentical: boolean;
    diffLines: number;
  };
  roleBefore?: string;
  roleAfter?: string;
  plan: string[];
  lines: string[];
  error?: { name: string; code?: string; message: string };
  failedAction?: { index: number; sql: string; message: string };
  timings: {
    setupMs?: number;
    planMs?: number;
    applyMs?: number;
    verifyMs?: number;
  };
  ms: number;
  resetMs?: number;
}

interface Ctx {
  a: Cluster;
  b: Cluster;
  pgMajor: number;
  /** supabase mode: roles present at container boot */
  builtinRoles?: string[];
}

async function prepareCluster(
  c: Cluster,
  kind: "createrole" | "superuser",
  inherit: boolean,
): Promise<void> {
  if (kind === "superuser") return;
  await c.adminPool.query(
    `CREATE ROLE ${q(APPLIER)} LOGIN PASSWORD '${APPLIER_PW}' CREATEROLE NOSUPERUSER ${inherit ? "INHERIT" : "NOINHERIT"}`,
  );
  if (ARGS.login === "stepdown") await createLoginRole(c, APPLIER);
}

/** `lab_login`: the role the CLI connects as; it steps down to `applier`. */
async function createLoginRole(c: Cluster, applier: string): Promise<void> {
  await c.adminPool.query(
    `CREATE ROLE ${q(LOGIN)} LOGIN PASSWORD '${LOGIN_PW}' NOSUPERUSER NOINHERIT`,
  );
  const grant =
    (await c.pgMajor()) >= 16
      ? `GRANT ${q(applier)} TO ${q(LOGIN)} WITH INHERIT FALSE, SET TRUE`
      : `GRANT ${q(applier)} TO ${q(LOGIN)}`;
  await c.adminPool.query(grant);
}

async function createDatabase(
  c: Cluster,
  name: string,
  kind: "createrole" | "superuser",
  dbOwner: "applier" | "superuser",
): Promise<void> {
  if (kind === "createrole" && dbOwner === "applier") {
    await c.adminPool.query(`CREATE DATABASE ${q(name)} OWNER ${q(APPLIER)}`);
    return;
  }
  await c.adminPool.query(`CREATE DATABASE ${q(name)}`);
  if (kind === "createrole") {
    await c.adminPool.query(
      `GRANT CONNECT, CREATE ON DATABASE ${q(name)} TO ${q(APPLIER)}`,
    );
    const p = mkPool(c.uriFor(name));
    try {
      await p.query(`GRANT ALL ON SCHEMA public TO ${q(APPLIER)}`);
    } finally {
      await p.end().catch(() => {});
    }
  }
}

async function resetClusters(ctx: Ctx): Promise<Ctx> {
  const cleanOne = async (c: Cluster): Promise<void> => {
    for (const db of [SRC_DB, DST_DB])
      await c.adminPool.query(`DROP DATABASE IF EXISTS ${q(db)} WITH (FORCE)`);
    const roles = await c.adminPool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND oid <> 10`,
    );
    for (const { rolname } of roles.rows) {
      await c.adminPool
        .query(`DROP OWNED BY ${q(rolname)} CASCADE`)
        .catch(() => {});
      await c.adminPool.query(`DROP ROLE ${q(rolname)}`);
    }
  };
  try {
    await Promise.all([cleanOne(ctx.a), cleanOne(ctx.b)]);
    return ctx;
  } catch (e) {
    console.error(
      `!! WARNING: role/database cleanup failed (${errInfo(e).message}); restarting the cluster pair`,
    );
    await stopAllClusters();
    const [a, b] = await isolatedClusterPair();
    return { ...ctx, a, b };
  }
}

function blankRecord(
  scenario: string,
  direction: Direction,
  meta: Meta,
  pgMajor: number,
): RunRecord {
  return {
    image: ARGS.image,
    scenario,
    direction,
    applier: ARGS.applier,
    applierMode: ARGS.applier,
    login: ARGS.login,
    via: ARGS.via,
    supabase: ARGS.supabase,
    outcome: "OK",
    detail: "",
    verdict: "NA",
    flags: [],
    // a superuser applier can do anything: `refuse` is meaningless there
    ideal:
      ARGS.applier === "superuser"
        ? "converge"
        : resolveIdeal(meta, pgMajor, direction),
    tags: meta.tags ?? [],
    segments: 0,
    plan: [],
    lines: [],
    timings: {},
    ms: 0,
  };
}

/** What a run leaves behind for the reference comparison (kept out of the JSON). */
interface RunInternals {
  resLines: string[];
  desLines: string[];
  lost: string[];
  bootstrap: string;
}
const internals = new WeakMap<RunRecord, RunInternals>();

/** `ref`: rebuild the same source/desired, plan WITHOUT any applier capability
 *  and apply as the cluster superuser. Its outcome is REF_*. */
async function runOne(
  ctx: Ctx,
  sc: Scenario,
  direction: Direction,
  mode: "main" | "ref" = "main",
): Promise<RunRecord> {
  const started = Date.now();
  let mark = started;
  const lap = (): number => {
    const now = Date.now();
    const d = now - mark;
    mark = now;
    return d;
  };
  const meta = sc.meta;
  const kind = ARGS.applier;
  const rec = blankRecord(sc.name, direction, meta, ctx.pgMajor);
  rec.applier = ARGS.supabase
    ? kind === "superuser"
      ? "supabase_admin"
      : "postgres"
    : kind;
  let typedError = false;
  const finish = (outcome: string, detail: string): RunRecord => {
    if (mode === "ref") {
      rec.outcome =
        outcome === "PLAN_THROW"
          ? "REF_PLAN_THROW"
          : outcome === "OK" || outcome === "CATALOG_DRIFT"
            ? "REF_OK"
            : outcome.includes("FACT_DRIFT")
              ? "REF_NONCONVERGED"
              : outcome === "APPLY_FAIL"
                ? "REF_APPLY_FAIL"
                : outcome;
      rec.detail = detail;
      rec.verdict = "NA";
      rec.ms = Date.now() - started;
      return rec;
    }
    rec.outcome = outcome;
    rec.detail = detail;
    rec.verdict = computeVerdict({
      outcome,
      flags: rec.flags,
      ideal: rec.ideal,
      segments: rec.segments,
      ...(rec.failClean ? { failClean: rec.failClean } : {}),
      typedError,
    });
    rec.ms = Date.now() - started;
    return rec;
  };

  if (
    (meta.minVersion !== undefined && ctx.pgMajor < meta.minVersion) ||
    (meta.maxVersion !== undefined && ctx.pgMajor > meta.maxVersion)
  )
    return finish("SKIPPED", `PG ${ctx.pgMajor} outside meta version range`);

  const rev = direction === "reverse";
  const side = (s: "a" | "b") => {
    const useA = rev ? s === "b" : s === "a";
    return useA
      ? {
          pre: sc.preA,
          main: sc.a,
          post: sc.postA,
          seed: sc.seedA,
          preF: "pre-a.sql",
          mainF: "a.sql",
          postF: "post-a.sql",
          seedF: "seed-a.sql",
        }
      : {
          pre: sc.preB,
          main: sc.b,
          post: sc.postB,
          seed: sc.seedB,
          preF: "pre-b.sql",
          mainF: "b.sql",
          postF: "post-b.sql",
          seedF: "seed-b.sql",
        };
  };
  const srcSide = side("a");
  const dstSide = side("b");

  const pools: pg.Pool[] = [];
  const track = (p: pg.Pool): pg.Pool => {
    pools.push(p);
    return p;
  };
  const inherit = meta.applierInherit ?? true;
  const dbOwner = meta.dbOwner ?? "applier";
  const execAs = meta.executeAs ?? "applier";
  const supa = ARGS.supabase;
  if (supa) {
    if (!inherit || dbOwner !== "applier")
      console.log(
        `# note: ${sc.name}: meta.applierInherit/dbOwner ignored in --supabase mode`,
      );
    const fix = (x: string | undefined): string | undefined =>
      x === undefined ? undefined : x.replaceAll("lab_applier", "postgres");
    for (const sd of [srcSide, dstSide]) {
      sd.pre = fix(sd.pre);
      sd.main = fix(sd.main) ?? "";
      sd.post = fix(sd.post);
      sd.seed = fix(sd.seed);
    }
  }
  const SRC = supa ? "postgres" : SRC_DB;
  const DST = supa ? "postgres" : DST_DB;
  const applierName = supa ? "postgres" : APPLIER;
  const applierPw = supa ? "postgres" : APPLIER_PW;
  // stepdown only makes sense for a non-superuser applier
  const stepdown = ARGS.login === "stepdown" && kind === "createrole";
  const stepdownTo = stepdown ? applierName : undefined;
  const apPool = (
    cl: Cluster,
    db: string,
    max?: number,
    direct = false,
  ): pg.Pool =>
    track(
      mkPool(
        stepdown && !direct
          ? uriAs(cl.uriFor(db), LOGIN, LOGIN_PW)
          : uriAs(cl.uriFor(db), applierName, applierPw),
        {
          ...(max !== undefined ? { max } : {}),
          ...(stepdownTo !== undefined && !direct ? { stepdownTo } : {}),
        },
      ),
    );

  try {
    if (!supa) {
      await Promise.all([
        prepareCluster(ctx.a, kind, inherit),
        prepareCluster(ctx.b, kind, inherit),
      ]);
      await Promise.all([
        createDatabase(ctx.a, SRC_DB, kind, dbOwner),
        createDatabase(ctx.b, DST_DB, kind, dbOwner),
      ]);
    } else if (stepdown) {
      await Promise.all([
        createLoginRole(ctx.a, "postgres"),
        createLoginRole(ctx.b, "postgres"),
      ]);
    }
    const su = {
      src: track(mkPool(ctx.a.uriFor(SRC))),
      dst: track(mkPool(ctx.b.uriFor(DST))),
    };
    const ap =
      kind === "superuser"
        ? su
        : {
            src: apPool(ctx.a, SRC, undefined, mode === "ref"),
            dst: apPool(ctx.b, DST, undefined, mode === "ref"),
          };

    // 3. setup. Scenario SQL may use session_user / SET ROLE, which mean
    // something else behind a login role, so by default it runs over direct
    // applier connections; only extract/probe/plan/apply step down.
    const setupAp =
      stepdown && !ARGS.stepdownSetup
        ? {
            src: apPool(ctx.a, SRC, undefined, true),
            dst: apPool(ctx.b, DST, undefined, true),
          }
        : stepdown && mode === "ref"
          ? { src: apPool(ctx.a, SRC), dst: apPool(ctx.b, DST) }
          : ap;
    for (const [s, label, suPool, apPool2] of [
      [srcSide, "source", su.src, setupAp.src],
      [dstSide, "desired", su.dst, setupAp.dst],
    ] as const) {
      await runSql(suPool, s.pre, `${s.preF} (${label}, superuser)`);
      await runSql(apPool2, s.main, `${s.mainF} (${label}, applier)`);
      await runSql(suPool, s.post, `${s.postF} (${label}, superuser)`);
    }
    // 3b. seed the source with data (superuser) for the data-preservation oracle
    await seedData(su.src, supa, srcSide.seed, srcSide.seedF);
    const dataBefore = await snapTables(su.src, supa);
    rec.timings.setupMs = lap();

    // 4. extract + plan
    const profile: ResolvedProfile | undefined =
      supa && !ARGS.noProfile
        ? await resolveProfile(
            ap.src,
            supabaseProfile,
            mode === "ref" ? { restrictToApplier: false } : {},
          )
        : undefined;
    const doExtract = (p: pg.Pool) =>
      profile ? profile.extract(p) : extract(p);
    const sourceState = await doExtract(ap.src);
    const desiredState = await doExtract(ap.dst);
    const capability =
      mode === "ref" ? undefined : await probeApplierCapability(ap.src);
    const planOptions = {
      ...(profile ? profile.planOptions : capability ? { capability } : {}),
      renames: meta.renames ?? "off",
      ...(meta.planParams ? { params: meta.planParams } : {}),
    };
    let thePlan: Plan;
    let desiredFacts = desiredState.factBase;
    try {
      if (meta.settleDesired === true) {
        const settled = await planSettled(
          ap.dst,
          sourceState.factBase,
          desiredState.factBase,
          planOptions,
        );
        desiredFacts = settled.desired;
        thePlan = settled.plan;
      } else {
        thePlan = plan(
          sourceState.factBase,
          desiredState.factBase,
          planOptions,
        );
      }
    } catch (e) {
      const info = errInfo(e);
      typedError = isTypedRefusal(info);
      rec.error = {
        name: info.name,
        message: info.message,
        ...(info.code ? { code: info.code } : {}),
      };
      rec.timings.planMs = lap();
      return finish(
        "PLAN_THROW",
        `${info.name}${info.code ? `[${info.code}]` : ""}: ${info.message}`,
      );
    }
    rec.timings.planMs = lap();
    rec.plan = thePlan.actions.map((a) => a.sql);
    rec.segments = segmentActions(thePlan.actions).length;
    // `blockers` exists only on trees with the applier-authorization pass
    const blockers =
      (
        thePlan as {
          blockers?: {
            code: string;
            role: string;
            reason: string;
            objects: string[];
          }[];
        }
      ).blockers ?? [];
    if (blockers.length > 0) {
      rec.lines.push(
        ...blockers.map(
          (b) =>
            `blocker ${b.code}: role "${b.role}" — ${b.reason} (${b.objects.join(", ")})`,
        ),
      );
      return finish(
        "BLOCKED",
        blockers.map((b) => `${b.role}: ${b.reason}`).join("; "),
      );
    }

    const verifyAfterApply = async (): Promise<RunRecord> => {
      // 6. fact drift
      const outcomes: string[] = [];
      const details: string[] = [];
      try {
        const profile2 =
          supa && !ARGS.noProfile
            ? await resolveProfile(
                ap.src,
                supabaseProfile,
                mode === "ref" ? { restrictToApplier: false } : {},
              )
            : undefined;
        const resultState = await (profile2
          ? profile2.extract(ap.src)
          : extract(ap.src));
        const cap2 =
          mode === "ref" ? undefined : await probeApplierCapability(ap.src);
        const replan = plan(resultState.factBase, desiredFacts, {
          ...(profile2
            ? profile2.planOptions
            : cap2
              ? { capability: cap2 }
              : {}),
          renames: meta.renames ?? "off",
        });
        if (replan.actions.length > 0) {
          outcomes.push("FACT_DRIFT");
          details.push(
            `${replan.actions.length} leftover action(s): ${replan.actions.map((a) => a.sql).join(" ; ")}`,
          );
          rec.lines.push(...replan.actions.map((a) => `leftover: ${a.sql}`));
        }
      } catch (e) {
        outcomes.push("FACT_DRIFT");
        details.push(`replan threw: ${errInfo(e).message}`);
      }

      // 7. catalog truth
      const [resLines, desLines] = await Promise.all([
        catalogLines(su.src, ctx.pgMajor, ctx.builtinRoles),
        catalogLines(su.dst, ctx.pgMajor, ctx.builtinRoles),
      ]);
      // a membership of the applier the plan says it leaves as found (a plan
      // warning, read structurally like `blockers`) is not compared
      const left = (
        (thePlan as { diagnostics?: { code: string; subject?: unknown }[] })
          .diagnostics ?? []
      )
        .filter((x) => x.code === "applier_membership_left")
        .map((x) => (x.subject as { role?: string } | undefined)?.role)
        .filter((r): r is string => r !== undefined)
        .flatMap((r) => [
          `memberuse ${r} <- ${applierName} `,
          `member ${r} <- ${applierName} `,
        ]);
      const compared = (lines: string[]) =>
        lines.filter((l) => !left.some((prefix) => l.startsWith(prefix)));
      if (left.length > 0) rec.flags.push("MEMBER_LEFT");
      const d = multisetDiff(compared(desLines), compared(resLines));
      if (d.onlyDesired.length + d.onlyResult.length > 0) {
        outcomes.push("CATALOG_DRIFT");
        details.push(
          `${d.onlyDesired.length} only in desired, ${d.onlyResult.length} only in result`,
        );
        rec.lines.push(
          ...d.onlyDesired.map((l) => `- ${l}`),
          ...d.onlyResult.map((l) => `+ ${l}`),
        );
      }

      // 7b. informational: effective membership of the applier (all grantors)
      if (ctx.pgMajor >= 16) {
        const applierName = supa ? "postgres" : APPLIER;
        const eff = async (p: pg.Pool) =>
          new Map(
            (
              await p.query<{ r: string; i: boolean; s: boolean }>(
                `SELECT pg_get_userbyid(m.roleid) AS r, bool_or(m.inherit_option) AS i, bool_or(m.set_option) AS s
                   FROM pg_auth_members m
                  WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
                  GROUP BY 1`,
                [applierName],
              )
            ).rows.map((x) => [x.r, x] as const),
          );
        const [er, ed] = await Promise.all([eff(su.src), eff(su.dst)]);
        const fmt = (x?: { i: boolean; s: boolean }) =>
          `inherit=${x?.i ? "t" : "f"} set=${x?.s ? "t" : "f"}`;
        const use: string[] = [];
        for (const role of [...new Set([...er.keys(), ...ed.keys()])].sort()) {
          const a = er.get(role);
          const b = ed.get(role);
          if (fmt(a) !== fmt(b))
            use.push(`${role}: result ${fmt(a)}, desired ${fmt(b)}`);
        }
        if (use.length > 0) {
          rec.flags.push("MEMBER_USE");
          rec.memberUse = use;
        }
      }

      // 8. data preservation
      const desiredTables = new Set(
        (await listTables(su.dst, supa)).map((t) => `${t.schema}.${t.name}`),
      );
      const lost = dataLoss(
        dataBefore,
        await snapTables(su.src, supa),
        desiredTables,
      );
      internals.set(rec, {
        resLines,
        desLines,
        lost,
        bootstrap: (
          await su.src.query<{ rolname: string }>(
            `SELECT rolname FROM pg_roles WHERE oid = 10`,
          )
        ).rows[0]!.rolname,
      });
      if (lost.length > 0) {
        rec.flags.push("DATA_LOSS");
        details.push(`DATA_LOSS: ${lost.join("; ")}`);
        rec.lines.push(...lost.map((l) => `DATA_LOSS ${l}`));
      }
      rec.timings.verifyMs = lap();
      if (outcomes.length === 0) return finish("OK", details.join("; "));
      return finish(outcomes.join("+"), details.join("; "));
    };

    if (mode === "ref") {
      const refPool = track(mkPool(ctx.a.uriFor(SRC), { max: 1 }));
      let refReport: Awaited<ReturnType<typeof apply>>;
      try {
        refReport = await apply(thePlan, refPool, {
          ...(profile ? profile.applyOptions : {}),
          fingerprintGate: false,
        });
      } catch (e) {
        return finish("APPLY_FAIL", errInfo(e).message);
      }
      if (refReport.status !== "applied") {
        const e = refReport.error;
        return finish(
          "APPLY_FAIL",
          `action ${e?.actionIndex}: ${e?.message} -- ${e?.sql}`,
        );
      }
      return await verifyAfterApply();
    }

    // 5. apply, on ONE connection whose session state is recorded around it
    let scriptText = "";
    if (ARGS.via === "script") {
      try {
        scriptText = renderApplyScript(thePlan);
      } catch (e) {
        const info = errInfo(e);
        rec.error = {
          name: info.name,
          message: info.message,
          ...(info.code ? { code: info.code } : {}),
        };
        return finish("BLOCKED", `render refused: ${info.message}`);
      }
    }
    const beforeLines = await catalogLines(
      su.src,
      ctx.pgMajor,
      ctx.builtinRoles,
    );
    const beforeHash = sourceState.factBase.rootHash;
    const applyAsSuper = kind === "superuser" || execAs === "superuser";
    const applyPool = applyAsSuper
      ? track(mkPool(ctx.a.uriFor(SRC), { max: 1 }))
      : apPool(ctx.a, SRC, 1);

    interface ApplyResult {
      status: "applied" | "failed";
      error?: { actionIndex: number; sql: string; message: string };
    }
    let report: ApplyResult | undefined;
    let thrown: unknown;
    if (ARGS.via === "apply") {
      rec.roleBefore = await sessionState(applyPool);
      try {
        report = await apply(thePlan, applyPool, {
          ...(profile ? profile.applyOptions : {}),
          fingerprintGate: false,
        });
      } catch (e) {
        thrown = e;
      }
      rec.roleAfter = await sessionStateSafe(applyPool);
    } else {
      const client = await applyPool.connect();
      try {
        rec.roleBefore = await sessionState(client);
        // as the script's header says: one statement at a time, in order, on
        // one session, stopping at the first error (BEGIN/COMMIT are statements)
        const statements = splitSqlStatements(scriptText);
        report = { status: "applied" };
        for (const [i, stmt] of statements.entries()) {
          try {
            await client.query(stmt);
          } catch (e) {
            report = {
              status: "failed",
              error: {
                actionIndex: i,
                sql: stmt.trim(),
                message: errInfo(e).message,
              },
            };
            // the script runner would exit here; do not leave an aborted block
            await client.query("ROLLBACK").catch(() => {});
            break;
          }
        }
        rec.roleAfter = await sessionStateSafe(client);
      } finally {
        client.release();
      }
    }
    rec.timings.applyMs = lap();
    if (rec.roleBefore !== rec.roleAfter) {
      rec.flags.push("ROLE_LEFT");
      rec.lines.push(
        `ROLE_LEFT before: ${rec.roleBefore}`,
        `ROLE_LEFT after:  ${rec.roleAfter}`,
      );
    }
    if (thrown !== undefined) {
      const info = errInfo(thrown);
      rec.error = {
        name: info.name,
        message: info.message,
        ...(info.code ? { code: info.code } : {}),
      };
      if (
        info.name === "ApplierIdentityError" ||
        info.code === "applier_identity"
      )
        return finish("REFUSED_IDENTITY", info.message);
      if (isTypedRefusal(info)) return finish("BLOCKED", info.message);
      throw thrown;
    }
    if (report === undefined || report.status !== "applied") {
      const e = report?.error;
      if (e)
        rec.failedAction = {
          index: e.actionIndex,
          sql: e.sql,
          message: e.message,
        };
      // fail-clean: did the SOURCE database change anyway?
      const afterLines = await catalogLines(
        su.src,
        ctx.pgMajor,
        ctx.builtinRoles,
      );
      const d = multisetDiff(beforeLines, afterLines);
      const diffLines = [
        ...d.onlyDesired.map((l) => `dirty - ${l}`),
        ...d.onlyResult.map((l) => `dirty + ${l}`),
      ];
      try {
        const st = await doExtract(ap.src);
        if (st.factBase.rootHash !== beforeHash)
          diffLines.push("dirty: source fact base changed");
      } catch (err) {
        diffLines.push(`dirty?: re-extract failed: ${errInfo(err).message}`);
      }
      rec.failClean = diffLines.length === 0 ? "clean" : "dirty";
      rec.lines.push(...diffLines);
      rec.timings.verifyMs = lap();
      return finish(
        "APPLY_FAIL",
        `${rec.failClean} (${rec.segments} segment(s)) action ${e?.actionIndex}: ${e?.message} -- ${e?.sql}`,
      );
    }

    return await verifyAfterApply();
  } catch (e) {
    if (e instanceof SetupError)
      return finish("SETUP_FAIL", `${e.file}: ${e.message}`);
    const info = errInfo(e);
    rec.lines.push(info.stack ?? info.message);
    return finish("HARNESS_ERROR", info.message);
  } finally {
    await Promise.all(pools.map((p) => p.end().catch(() => {})));
  }
}

// ── reference comparison ─────────────────────────────────────────────────────
/** Only runs whose verdict depends on the reference get one: a non-superuser
 *  result that drifted or is NONCONVERGED, or a loud failure. Clean passes,
 *  role-leaks and dirty failures never change verdict, so they skip it. */
function needsReference(rec: RunRecord): boolean {
  if (!ARGS.reference || ARGS.applier !== "createrole") return false;
  if (rec.flags.includes("ROLE_LEFT")) return false;
  return (
    rec.verdict === "LOUD" ||
    rec.verdict === "NONCONVERGED" ||
    (rec.verdict === "SILENT" && rec.outcome !== "APPLY_FAIL")
  );
}

function attachReference(rec: RunRecord, ref: RunRecord): void {
  const mi = internals.get(rec);
  const ri = internals.get(ref);
  let sameResult = false;
  let strict = false;
  let diff: string[] = [];
  if (mi && ri) {
    const applier = rec.supabase ? "postgres" : APPLIER;
    const a = normalizeRefLines(mi.resLines, applier, mi.bootstrap);
    const b = normalizeRefLines(ri.resLines, applier, ri.bootstrap);
    diff = [
      ...[...b]
        .filter((l) => !a.has(l))
        .sort()
        .map((l) => `vs-superuser - ${l}`),
      ...[...a]
        .filter((l) => !b.has(l))
        .sort()
        .map((l) => `vs-superuser + ${l}`),
    ];
    // Main is "no worse than the superuser" when every way it deviates from
    // the desired state is one the superuser result deviates in too. (A stricter
    // identical-sets test would flag main when it is CLOSER to desired, e.g.
    // it revokes the applier's own memberships and the superuser plan keeps them.)
    const des = normalizeRefLines(mi.desLines, applier, mi.bootstrap);
    const drift = (x: Set<string>): Set<string> =>
      new Set([
        ...[...des].filter((l) => !x.has(l)).map((l) => `- ${l}`),
        ...[...x].filter((l) => !des.has(l)).map((l) => `+ ${l}`),
      ]);
    const da = drift(a);
    const db = drift(b);
    sameResult = [...da].every((l) => db.has(l));
    strict = diff.length === 0;
  }
  const tables = (xs: string[]): string =>
    JSON.stringify(
      xs
        .map((x) => x.split(" (")[0])
        .sort((p, q) => (p ?? "").localeCompare(q ?? "")),
    );
  const sameDataLoss = tables(mi?.lost ?? []) === tables(ri?.lost ?? []);
  rec.reference = {
    outcome: ref.outcome,
    detail:
      ref.detail.length > 400 ? `${ref.detail.slice(0, 397)}...` : ref.detail,
    dataLoss: ri?.lost ?? [],
    plan: ref.plan,
    sameResult,
    strictlyIdentical: strict,
    diffLines: diff.length,
  };
  const r = refineVerdict({
    verdict: rec.verdict,
    outcome: rec.outcome,
    flags: rec.flags,
    refOutcome: ref.outcome,
    sameResult,
    sameDataLoss,
  });
  rec.verdict = r.verdict;
  rec.flags.push(...r.addFlags);
  if (
    diff.length > 0 &&
    (r.verdict === "SILENT" || r.verdict === "NONCONVERGED")
  )
    rec.lines.push(...diff);
  if (ref.outcome === "REF_APPLY_FAIL" || ref.outcome === "REF_PLAN_THROW")
    rec.lines.push(`reference ${ref.outcome}: ${oneLine(ref.detail, 300)}`);
}

// ── baselines ────────────────────────────────────────────────────────────────
interface BaselineLine {
  scenario: string;
  direction: string;
  image: string;
  applierMode: string;
  login: string;
  via: string;
  supabase: boolean;
  outcome: string;
  verdict: string;
  flags: string[];
  plan: string[];
}

function recKey(r: {
  scenario: string;
  direction: string;
  image: string;
  applierMode: string;
  login: string;
  via: string;
  supabase: boolean;
}): string {
  return baselineKey({
    scenario: r.scenario,
    direction: r.direction,
    image: r.image,
    applier: r.applierMode,
    login: r.login,
    via: r.via,
    supabase: r.supabase,
  });
}

function loadBaseline(file: string): Map<string, BaselineLine> {
  const m = new Map<string, BaselineLine>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const b = JSON.parse(line) as BaselineLine;
    m.set(recKey(b), b);
  }
  return m;
}

function judgeAgainst(
  baseline: Map<string, BaselineLine> | undefined,
  rec: RunRecord,
): void {
  if (baseline === undefined) return;
  const b = baseline.get(recKey(rec));
  if (b === undefined) {
    rec.baseline = "no-baseline";
    return;
  }
  rec.baseline = "compared";
  rec.baselineVerdict = b.verdict;
  if (b.verdict === "PASS" && rec.verdict !== "PASS") {
    rec.rawVerdict = rec.verdict;
    rec.verdict = "REGRESSION";
  }
  if (
    ARGS.applier === "superuser" &&
    JSON.stringify(b.plan) !== JSON.stringify(rec.plan)
  ) {
    rec.flags.push("PLAN_CHANGED");
    rec.lines.push(...statementDiff(b.plan, rec.plan));
  }
}

// ── reporting ────────────────────────────────────────────────────────────────
function oneLine(s: string, max = 160): string {
  const t = s.replaceAll("\n", " ");
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

function verdictLabel(r: RunRecord): string {
  return r.verdict === "REGRESSION"
    ? `REGRESSION(now ${r.rawVerdict})`
    : r.verdict;
}

function printRun(r: RunRecord): void {
  const flags = r.flags.length > 0 ? ` [${r.flags.join(",")}]` : "";
  console.log(
    `[${r.image}] ${r.scenario} ${r.direction} → ${r.outcome} ${verdictLabel(r)}${flags}${r.detail ? ` ${oneLine(r.detail)}` : ""}`,
  );
  const interesting = r.verdict !== "PASS" && r.outcome !== "SKIPPED";
  const noisy = ARGS.corpus && r.outcome === "SETUP_FAIL";
  if (ARGS.verbose || (interesting && !noisy)) {
    r.plan.forEach((sql, i) =>
      console.log(`    ${i}: ${sql.replaceAll("\n", "\n       ")}`),
    );
    for (const l of r.lines) console.log(`    ${l}`);
    if (r.failedAction)
      console.log(
        `    failed action ${r.failedAction.index}: ${r.failedAction.sql}\n    pg: ${r.failedAction.message}`,
      );
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<number> {
  let dirs: string[] = [...ARGS.dirs];
  if (ARGS.all || ARGS.suite)
    dirs.push(...listScenarioDirs(join(HERE, "scenarios")));
  if (ARGS.suite) {
    dirs.push(...listScenarioDirs(join(HERE, "adversarial")));
    dirs.push(...listScenarioDirs(join(HERE, "generated")));
    if (ARGS.supabase) dirs.push(...listScenarioDirs(join(HERE, "supabase")));
  }
  if (ARGS.corpus) {
    const root = resolve(HERE, "../../corpus");
    dirs.push(
      ...listDirs(root).filter(
        (d) => ARGS.filter === undefined || basename(d).includes(ARGS.filter),
      ),
    );
  }
  dirs = [...new Set(dirs.map((d) => resolve(d)))].sort();
  if (ARGS.shard)
    dirs = dirs.filter((_, i) => i % ARGS.shard!.n === ARGS.shard!.i - 1);
  if (dirs.length === 0) {
    console.error("no scenarios: pass dirs, --suite, --all, or --corpus");
    return 2;
  }
  const directions: Direction[] =
    ARGS.direction === "both" ? ["forward", "reverse"] : [ARGS.direction];
  const baseline = ARGS.compareBaseline
    ? loadBaseline(ARGS.compareBaseline)
    : undefined;
  if (ARGS.json) writeFileSync(ARGS.json, "");
  if (ARGS.recordBaseline) writeFileSync(ARGS.recordBaseline, "");

  let ctx: Ctx;
  let pgMajor: number;
  const modes = `applier=${ARGS.applier} login=${ARGS.login} via=${ARGS.via}${ARGS.shard ? ` shard=${ARGS.shard.i}/${ARGS.shard.n}` : ""}`;
  if (ARGS.supabase) {
    // fresh containers per run; this first pair is only used to report the
    // version and is reused by the first run.
    const [sa, sb] = await Promise.all([
      startSupabase(ARGS.image),
      startSupabase(ARGS.image),
    ]);
    pgMajor = await sa.cluster.pgMajor();
    const ver = await sa.cluster.adminPool.query<{ version: string }>(
      "select version()",
    );
    console.log(`# image ${ARGS.image}: ${ver.rows[0]?.version}`);
    console.log(
      `# supabase mode ${modes} (applier role ${ARGS.applier === "superuser" ? "supabase_admin" : "postgres"}) scenarios=${dirs.length} directions=${directions.join(",")}`,
    );
    ctx = {
      a: sa.cluster,
      b: sb.cluster,
      pgMajor,
      builtinRoles: sa.builtinRoles,
    };
  } else {
    const [a, b] = await isolatedClusterPair();
    pgMajor = await a.pgMajor();
    const ver = await a.adminPool.query<{ version: string }>(
      "select version()",
    );
    console.log(`# image ${ARGS.image}: ${ver.rows[0]?.version}`);
    console.log(
      `# ${modes} scenarios=${dirs.length} directions=${directions.join(",")}`,
    );
    ctx = { a, b, pgMajor };
  }
  if (ARGS.login === "stepdown" && ARGS.applier === "superuser")
    console.log("# note: --login stepdown is ignored with --applier superuser");
  let fresh = ARGS.supabase; // supabase: the pair in ctx has not been used yet

  const records: RunRecord[] = [];
  const emit = (rec: RunRecord): void => {
    judgeAgainst(baseline, rec);
    records.push(rec);
    printRun(rec);
    if (ARGS.json)
      appendFileSync(ARGS.json, `${JSON.stringify({ ...rec, pgMajor })}\n`);
    if (ARGS.recordBaseline) {
      const line: BaselineLine & { tags: string[]; ideal: Ideal } = {
        scenario: rec.scenario,
        direction: rec.direction,
        image: rec.image,
        applierMode: rec.applierMode,
        login: rec.login,
        via: rec.via,
        supabase: rec.supabase,
        outcome: rec.outcome,
        verdict: rec.rawVerdict ?? rec.verdict,
        flags: rec.flags.filter((f) => f !== "PLAN_CHANGED"),
        plan: rec.plan,
        tags: rec.tags,
        ideal: rec.ideal,
      };
      appendFileSync(ARGS.recordBaseline, `${JSON.stringify(line)}\n`);
    }
  };
  try {
    for (const dir of dirs) {
      let sc: Scenario;
      try {
        sc = loadScenario(dir);
      } catch (e) {
        for (const direction of directions) {
          const rec = blankRecord(relative(HERE, dir), direction, {}, pgMajor);
          rec.outcome = "HARNESS_ERROR";
          rec.detail = errInfo(e).message;
          emit(rec);
        }
        continue;
      }
      for (const direction of directions) {
        let rec: RunRecord;
        if (ARGS.supabase && !fresh) {
          const [sa, sb] = await Promise.all([
            startSupabase(ARGS.image),
            startSupabase(ARGS.image),
          ]);
          ctx = {
            ...ctx,
            a: sa.cluster,
            b: sb.cluster,
            builtinRoles: sa.builtinRoles,
          };
        }
        try {
          rec = await runOne(ctx, sc, direction);
        } catch (e) {
          const info = errInfo(e);
          rec = blankRecord(sc.name, direction, sc.meta, pgMajor);
          rec.outcome = "HARNESS_ERROR";
          rec.detail = info.message;
          rec.lines = [info.stack ?? info.message];
        }
        const resetStart = Date.now();
        const doReset = async (): Promise<void> => {
          if (ARGS.supabase) {
            await Promise.all([stopSupabase(ctx.a), stopSupabase(ctx.b)]);
            fresh = false;
          } else ctx = await resetClusters(ctx);
        };
        await doReset();
        if (needsReference(rec)) {
          if (ARGS.supabase) {
            const [sa, sb] = await Promise.all([
              startSupabase(ARGS.image),
              startSupabase(ARGS.image),
            ]);
            ctx = {
              ...ctx,
              a: sa.cluster,
              b: sb.cluster,
              builtinRoles: sa.builtinRoles,
            };
          }
          let refRec: RunRecord;
          try {
            refRec = await runOne(ctx, sc, direction, "ref");
          } catch (e) {
            refRec = blankRecord(sc.name, direction, sc.meta, pgMajor);
            refRec.outcome = "HARNESS_ERROR";
            refRec.detail = errInfo(e).message;
          }
          await doReset();
          attachReference(rec, refRec);
        }
        rec.resetMs = Date.now() - resetStart;
        emit(rec);
      }
    }
  } finally {
    await stopAllClusters().catch(() => {});
    await Promise.all([...supaLive].map((c) => stopSupabase(c)));
  }

  // summary
  const count = (key: (r: RunRecord) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of records) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m].sort((x, y) => x[0].localeCompare(y[0]));
  };
  console.log(`\n== summary (${modes}${ARGS.supabase ? " supabase" : ""}) ==`);
  console.log("-- verdicts --");
  for (const [k, v] of count((r) => r.verdict))
    console.log(`${String(v).padStart(5)}  ${k}`);
  console.log("-- outcomes --");
  for (const [k, v] of count((r) => r.outcome))
    console.log(`${String(v).padStart(5)}  ${k}`);
  if (baseline) {
    for (const [k, v] of count((r) => r.baseline ?? "-"))
      console.log(`${String(v).padStart(5)}  baseline:${k}`);
    const changed = records.filter((r) => r.flags.includes("PLAN_CHANGED"));
    if (ARGS.applier === "superuser")
      console.log(`${String(changed.length).padStart(5)}  PLAN_CHANGED`);
  }
  const byVerdict = new Map<string, RunRecord[]>();
  for (const r of records) {
    if (
      r.verdict === "PASS" ||
      (r.verdict === "NA" && r.outcome !== "HARNESS_ERROR")
    )
      continue;
    const k = r.outcome === "HARNESS_ERROR" ? "HARNESS_ERROR" : r.verdict;
    byVerdict.set(k, [...(byVerdict.get(k) ?? []), r]);
  }
  const normalizeMsg = (m: string): string =>
    m
      .replace(/"[^"]*"/g, '"_"')
      .replace(/'[^']*'/g, "'_'")
      .replace(/ -- .*$/s, "")
      .replace(/\b\d+\b/g, "N")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  const engineKey = (r: RunRecord): string => {
    if (r.verdict === "LOUD_ENGINE")
      return normalizeMsg(
        r.failedAction?.message ?? r.error?.message ?? r.detail,
      );
    return [
      ...new Set(
        r.lines
          .filter((l) => /^[-+] |^DATA_LOSS /.test(l))
          .map((l) =>
            l
              .replace(/[\w$]+\.[\w$]+(\([^)]*\))?/g, "<obj>")
              .replace(/DATA_LOSS .*/, "DATA_LOSS"),
          ),
      ),
    ]
      .sort()
      .join(" | ");
  };
  for (const [verdict, rs] of [...byVerdict].sort((x, y) =>
    x[0].localeCompare(y[0]),
  )) {
    if (verdict === "ENGINE_GAP" || verdict === "LOUD_ENGINE") {
      const groups = new Map<string, RunRecord[]>();
      for (const r of rs)
        groups.set(engineKey(r), [...(groups.get(engineKey(r)) ?? []), r]);
      console.log(
        `\n-- ${verdict} (${rs.length} runs, ${groups.size} groups) --`,
      );
      for (const [k, g] of [...groups].sort(
        (x, y) => y[1].length - x[1].length,
      )) {
        console.log(`  (${g.length}) ${k}`);
        for (const r of g.slice(0, 3))
          console.log(`      e.g. ${r.scenario} ${r.direction}`);
      }
      continue;
    }
    console.log(`\n-- ${verdict} (${rs.length}) --`);
    for (const r of rs)
      console.log(
        `  ${r.scenario} ${r.direction}: ${r.outcome}${r.flags.length ? ` [${r.flags.join(",")}]` : ""} ${oneLine(r.detail, 120)}`,
      );
  }
  return records.some(
    (r) =>
      r.verdict === "SILENT" ||
      r.verdict === "REGRESSION" ||
      r.flags.includes("PLAN_CHANGED"),
  )
    ? 1
    : 0;
}

main().then(
  (code) => process.exit(code),
  async (e) => {
    console.error(e);
    await stopAllClusters().catch(() => {});
    await Promise.all([...supaLive].map((c) => stopSupabase(c)));
    process.exit(2);
  },
);
