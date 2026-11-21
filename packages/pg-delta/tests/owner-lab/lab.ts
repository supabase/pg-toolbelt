/**
 * owner-lab: run a scenario (a.sql -> b.sql) END TO END as a NON-superuser
 * applier on real Postgres and classify the outcome, including drift the fact
 * model cannot see (raw catalog comparison by name).
 *
 *   cd packages/pg-delta
 *   bun tests/owner-lab/lab.ts --image postgres:17-alpine <scenarioDir>...
 *   bun tests/owner-lab/lab.ts --image postgres:17-alpine --all
 *   bun tests/owner-lab/lab.ts --image postgres:17-alpine --corpus [--filter <substr>]
 *
 * Flags: --json <file>  --verbose  --direction forward|reverse|both
 *        --applier createrole|superuser
 *        --supabase  (two fresh supabase/postgres containers PER RUN; applier =
 *                     `postgres`, desired/source in database `postgres`, plan
 *                     through the supabase integration profile; --image must be
 *                     a supabase image)
 * See tests/owner-lab/README.md for the scenario directory contract.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import pg from "pg";
import { apply } from "../../src/apply/apply.ts";
import { extract } from "../../src/extract/extract.ts";
import { planSettled } from "../../src/frontends/settle-desired.ts";
import { plan, type Plan } from "../../src/plan/plan.ts";
import {
  resolveProfile,
  supabaseProfile,
} from "../../src/integrations/index.ts";
import type { ResolvedProfile } from "../../src/integrations/index.ts";
import type { RenameMode } from "../../src/plan/renames.ts";
import {
  ApplierIdentityError,
  CapabilityError,
  probeApplierCapability,
} from "../../src/policy/capability.ts";
import { GenericContainer, Wait } from "testcontainers";
import type { Cluster as ClusterT } from "../containers.ts";

// ── args ─────────────────────────────────────────────────────────────────────
interface Args {
  image: string;
  dirs: string[];
  all: boolean;
  corpus: boolean;
  filter?: string;
  json?: string;
  verbose: boolean;
  direction: "forward" | "reverse" | "both";
  applier: "createrole" | "superuser";
  supabase: boolean;
  /** --no-profile (with --supabase): plan with the raw probed capability only */
  noProfile: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    image: process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
    dirs: [],
    all: false,
    corpus: false,
    verbose: false,
    direction: "forward",
    applier: "createrole",
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
    else if (a === "--corpus") args.corpus = true;
    else if (a === "--filter") args.filter = next();
    else if (a === "--json") args.json = next();
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--supabase") args.supabase = true;
    else if (a === "--no-profile") args.noProfile = true;
    else if (a === "--direction") {
      const v = next();
      if (v !== "forward" && v !== "reverse" && v !== "both")
        throw new Error(`bad --direction ${v}`);
      args.direction = v;
    } else if (a === "--applier") {
      const v = next();
      if (v !== "createrole" && v !== "superuser")
        throw new Error(`bad --applier ${v}`);
      args.applier = v;
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
interface Meta {
  minVersion?: number;
  maxVersion?: number;
  expect?: "converge" | "refuse";
  applierInherit?: boolean;
  dbOwner?: "applier" | "superuser";
  executeAs?: "applier" | "superuser";
  notes?: string;
  /** corpus meta passthroughs */
  renames?: RenameMode;
  settleDesired?: boolean;
}
interface Scenario {
  name: string;
  a: string;
  b: string;
  preA?: string;
  preB?: string;
  postA?: string;
  postB?: string;
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
    name: basename(abs),
    a,
    b,
    meta: metaText ? (JSON.parse(metaText) as Meta) : {},
  };
  for (const [k, f] of [
    ["preA", "pre-a.sql"],
    ["preB", "pre-b.sql"],
    ["postA", "post-a.sql"],
    ["postB", "post-b.sql"],
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

// ── helpers ──────────────────────────────────────────────────────────────────
const APPLIER = "lab_applier";
const APPLIER_PW = "lab";
const SRC_DB = "lab_src";
const DST_DB = "lab_dst";

function mkPool(uri: string): pg.Pool {
  const p = new pg.Pool({ connectionString: uri, max: 4 });
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
function dbCatalogSql(supa: boolean): string {
  const nsFilter = supa
    ? `nspname NOT IN (${SUPA_PLATFORM_SCHEMAS.map(lit).join(",")}, 'information_schema')
    AND nspname NOT LIKE 'pg\\_%'`
    : `nspname NOT IN ('pg_catalog','information_schema')
    AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%'`;
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

function clusterCatalogSql(pgMajor: number, builtin?: string[]): string {
  if (builtin !== undefined) return supaClusterCatalogSql(pgMajor, builtin);
  const members =
    pgMajor >= 16
      ? `SELECT 'member ' || pg_get_userbyid(m.roleid) || ' <- ' || pg_get_userbyid(m.member)
              || ' admin=' || m.admin_option::text || ' inherit=' || m.inherit_option::text || ' set=' || m.set_option::text
              || ' grantor=' || pg_get_userbyid(m.grantor)
           FROM pg_auth_members m
          WHERE pg_get_userbyid(m.roleid) NOT LIKE 'pg\\_%' OR pg_get_userbyid(m.member) NOT LIKE 'pg\\_%'`
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
      ? `' admin=' || m.admin_option::text || ' inherit=' || m.inherit_option::text || ' set=' || m.set_option::text
              || ' grantor=' || pg_get_userbyid(m.grantor)`
      : `' admin=' || m.admin_option::text`;
  return `
SELECT 'member ' || pg_get_userbyid(m.roleid) || ' <- ' || pg_get_userbyid(m.member) || ${cols}
  FROM pg_auth_members m
 WHERE NOT (pg_get_userbyid(m.roleid) = ANY(${bl}))
    OR NOT (pg_get_userbyid(m.member) = ANY(${bl}))
    OR pg_get_userbyid(m.member) = 'postgres'
UNION ALL
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

// ── run ──────────────────────────────────────────────────────────────────────
type Direction = "forward" | "reverse";

interface RunRecord {
  image: string;
  scenario: string;
  direction: Direction;
  applier: string;
  outcome: string;
  detail: string;
  expect: "converge" | "refuse";
  expectMet: boolean;
  plan: string[];
  lines: string[];
  error?: { name: string; code?: string; message: string };
  failedAction?: { index: number; sql: string; message: string };
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

async function runOne(
  ctx: Ctx,
  sc: Scenario,
  direction: Direction,
): Promise<RunRecord> {
  const started = Date.now();
  const meta = sc.meta;
  const expect = meta.expect ?? "converge";
  const kind = ARGS.applier;
  const rec: RunRecord = {
    image: ARGS.image,
    scenario: sc.name,
    direction,
    applier: ARGS.supabase
      ? kind === "superuser"
        ? "supabase_admin"
        : "postgres"
      : kind,
    outcome: "OK",
    detail: "",
    expect,
    expectMet: false,
    plan: [],
    lines: [],
    ms: 0,
  };
  const finish = (outcome: string, detail: string): RunRecord => {
    rec.outcome = outcome;
    rec.detail = detail;
    rec.expectMet =
      outcome === "SKIPPED" ||
      (expect === "refuse"
        ? outcome === "BLOCKED" ||
          outcome === "REFUSED_IDENTITY" ||
          (outcome === "PLAN_THROW" && rec.error?.name === "CapabilityError")
        : outcome === "OK");
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
          preF: "pre-a.sql",
          mainF: "a.sql",
          postF: "post-a.sql",
        }
      : {
          pre: sc.preB,
          main: sc.b,
          post: sc.postB,
          preF: "pre-b.sql",
          mainF: "b.sql",
          postF: "post-b.sql",
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
    }
  }
  const SRC = supa ? "postgres" : SRC_DB;
  const DST = supa ? "postgres" : DST_DB;
  const applierName = supa ? "postgres" : APPLIER;
  const applierPw = supa ? "postgres" : APPLIER_PW;

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
    }
    const su = {
      src: track(mkPool(ctx.a.uriFor(SRC))),
      dst: track(mkPool(ctx.b.uriFor(DST))),
    };
    const ap =
      kind === "superuser"
        ? su
        : {
            src: track(
              mkPool(uriAs(ctx.a.uriFor(SRC), applierName, applierPw)),
            ),
            dst: track(
              mkPool(uriAs(ctx.b.uriFor(DST), applierName, applierPw)),
            ),
          };

    // 3. setup
    for (const [s, label, suPool, apPool] of [
      [srcSide, "source", su.src, ap.src],
      [dstSide, "desired", su.dst, ap.dst],
    ] as const) {
      await runSql(suPool, s.pre, `${s.preF} (${label}, superuser)`);
      await runSql(apPool, s.main, `${s.mainF} (${label}, applier)`);
      await runSql(suPool, s.post, `${s.postF} (${label}, superuser)`);
    }

    // 4. extract + plan
    const profile: ResolvedProfile | undefined =
      supa && !ARGS.noProfile
        ? await resolveProfile(ap.src, supabaseProfile)
        : undefined;
    const doExtract = (p: pg.Pool) =>
      profile ? profile.extract(p) : extract(p);
    const sourceState = await doExtract(ap.src);
    const desiredState = await doExtract(ap.dst);
    const capability = await probeApplierCapability(ap.src);
    const planOptions = {
      ...(profile ? profile.planOptions : { capability }),
      renames: meta.renames ?? "off",
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
      rec.error = {
        name: info.name,
        message: info.message,
        ...(info.code ? { code: info.code } : {}),
      };
      return finish(
        "PLAN_THROW",
        `${info.name}${info.code ? `[${info.code}]` : ""}: ${info.message}`,
      );
    }
    rec.plan = thePlan.actions.map((a) => a.sql);
    if ((thePlan.blockers?.length ?? 0) > 0) {
      rec.lines.push(
        ...(thePlan.blockers ?? []).map(
          (b) =>
            `blocker ${b.code}: role "${b.role}" — ${b.reason} (${b.objects.join(", ")})`,
        ),
      );
      return finish(
        "BLOCKED",
        (thePlan.blockers ?? [])
          .map((b) => `${b.role}: ${b.reason}`)
          .join("; "),
      );
    }

    // 5. apply
    let report: Awaited<ReturnType<typeof apply>>;
    try {
      report = await apply(thePlan, execAs === "superuser" ? su.src : ap.src, {
        ...(profile ? profile.applyOptions : {}),
        fingerprintGate: false,
      });
    } catch (e) {
      const info = errInfo(e);
      if (e instanceof ApplierIdentityError)
        return finish("REFUSED_IDENTITY", info.message);
      if (e instanceof CapabilityError) return finish("BLOCKED", info.message);
      throw e;
    }
    if (report.status !== "applied") {
      const e = report.error;
      if (e)
        rec.failedAction = {
          index: e.actionIndex,
          sql: e.sql,
          message: e.message,
        };
      return finish(
        "APPLY_FAIL",
        `action ${e?.actionIndex}: ${e?.message} -- ${e?.sql}`,
      );
    }

    // 6. fact drift
    const outcomes: string[] = [];
    const details: string[] = [];
    try {
      const profile2 =
        supa && !ARGS.noProfile
          ? await resolveProfile(ap.src, supabaseProfile)
          : undefined;
      const resultState = await (profile2
        ? profile2.extract(ap.src)
        : extract(ap.src));
      const cap2 = await probeApplierCapability(ap.src);
      const replan = plan(resultState.factBase, desiredFacts, {
        ...(profile2 ? profile2.planOptions : { capability: cap2 }),
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
    const d = multisetDiff(desLines, resLines);
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
    if (outcomes.length === 0) return finish("OK", "");
    return finish(outcomes.join("+"), details.join("; "));
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

// ── reporting ────────────────────────────────────────────────────────────────
function normalizeMsg(s: string): string {
  return s
    .replace(/"[^"]*"/g, '"_"')
    .replace(/'[^']*'/g, "'_'")
    .replace(/\(near:.*$/s, "")
    .replace(/ -- .*$/s, "")
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function groupKey(r: RunRecord): string {
  const msg = r.failedAction?.message ?? r.error?.message ?? r.detail ?? "";
  return normalizeMsg(msg);
}

function printRun(r: RunRecord, isCorpus: boolean): void {
  const short =
    r.detail.length > 160 ? `${r.detail.slice(0, 157)}...` : r.detail;
  console.log(
    `[${r.image}] ${r.scenario} ${r.direction} → ${r.outcome}${short ? ` ${short.replaceAll("\n", " ")}` : ""}`,
  );
  const interesting = r.outcome !== "OK" && r.outcome !== "SKIPPED";
  const noisy = isCorpus && r.outcome === "SETUP_FAIL";
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
  if (ARGS.all) dirs.push(...listDirs(join(HERE, "scenarios")));
  if (ARGS.corpus) {
    const root = resolve(HERE, "../../corpus");
    dirs.push(
      ...listDirs(root).filter(
        (d) => ARGS.filter === undefined || basename(d).includes(ARGS.filter),
      ),
    );
  }
  dirs = [...new Set(dirs)];
  if (dirs.length === 0) {
    console.error("no scenarios: pass dirs, --all, or --corpus");
    return 2;
  }
  const directions: Direction[] =
    ARGS.direction === "both" ? ["forward", "reverse"] : [ARGS.direction];

  let ctx: Ctx;
  let pgMajor: number;
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
      `# supabase mode applier=${ARGS.applier === "superuser" ? "supabase_admin" : "postgres"} scenarios=${dirs.length} directions=${directions.join(",")}`,
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
      `# applier=${ARGS.applier} scenarios=${dirs.length} directions=${directions.join(",")}`,
    );
    ctx = { a, b, pgMajor };
  }
  let fresh = ARGS.supabase; // supabase: the pair in ctx has not been used yet

  const records: RunRecord[] = [];
  try {
    for (const dir of dirs) {
      let sc: Scenario;
      try {
        sc = loadScenario(dir);
      } catch (e) {
        console.log(
          `[${ARGS.image}] ${basename(dir)} → HARNESS_ERROR ${errInfo(e).message}`,
        );
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
          rec = {
            image: ARGS.image,
            scenario: sc.name,
            direction,
            applier: ARGS.applier,
            outcome: "HARNESS_ERROR",
            detail: info.message,
            expect: sc.meta.expect ?? "converge",
            expectMet: false,
            plan: [],
            lines: [info.stack ?? info.message],
            ms: 0,
          };
        }
        const resetStart = Date.now();
        if (ARGS.supabase) {
          await Promise.all([stopSupabase(ctx.a), stopSupabase(ctx.b)]);
          fresh = false;
        } else ctx = await resetClusters(ctx);
        rec.resetMs = Date.now() - resetStart;
        records.push(rec);
        printRun(rec, ARGS.corpus);
        if (ARGS.json)
          appendFileSync(ARGS.json, `${JSON.stringify({ ...rec, pgMajor })}\n`);
      }
    }
  } finally {
    await stopAllClusters().catch(() => {});
    await Promise.all([...supaLive].map((c) => stopSupabase(c)));
  }

  // summary
  const counts = new Map<string, number>();
  for (const r of records)
    counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  console.log("\n== summary ==");
  for (const [k, v] of [...counts].sort((x, y) => x[0].localeCompare(y[0])))
    console.log(`${String(v).padStart(5)}  ${k}`);
  const groups = new Map<string, Map<string, RunRecord[]>>();
  for (const r of records) {
    if (r.outcome === "OK" || r.outcome === "SKIPPED") continue;
    const og = groups.get(r.outcome) ?? new Map<string, RunRecord[]>();
    const key = groupKey(r);
    og.set(key, [...(og.get(key) ?? []), r]);
    groups.set(r.outcome, og);
  }
  for (const [outcome, og] of groups) {
    console.log(`\n-- ${outcome} --`);
    for (const [key, rs] of [...og].sort((x, y) => y[1].length - x[1].length)) {
      console.log(`  (${rs.length}) ${key}`);
      if (outcome !== "SETUP_FAIL" || !ARGS.corpus)
        console.log(`      ${rs.map((r) => r.scenario).join(", ")}`);
    }
  }
  if (ARGS.corpus) return 0;
  return records.every((r) => r.expectMet) ? 0 : 1;
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
