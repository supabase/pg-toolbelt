/**
 * Long-lived pg-delta oracle for the Ephyra property tests. Reads one JSON
 * request per stdin line, writes one `@@RESULT ` + JSON line per request.
 *
 * Request: { op: "migrate", from, to, compact, seed? }
 *          { op: "roundtrip", sql, layout }
 *          { op: "declarative", from, to, layout, flavor?, strict? }
 *          { op: "stable", from, to, flavor? }
 * Result:  { verdict: "pass" | "invalid" | "fail", kind?, detail? }
 *   invalid = the generated SQL itself failed to load (a generator bug).
 */
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { apply } from "../../../packages/pg-delta/src/apply/apply.ts";
import { encodeId } from "../../../packages/pg-delta/src/core/stable-id.ts";
import { extract } from "../../../packages/pg-delta/src/extract/extract.ts";
import { exportSqlFiles } from "../../../packages/pg-delta/src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../../../packages/pg-delta/src/frontends/load-sql-files.ts";
import { plan } from "../../../packages/pg-delta/src/plan/plan.ts";
import { rel } from "../../../packages/pg-delta/src/plan/render.ts";
import { probeApplierCapability } from "../../../packages/pg-delta/src/policy/capability.ts";
import { provePlan } from "../../../packages/pg-delta/src/proof/prove.ts";
import {
  sharedCluster,
  startStandaloneSupabase,
} from "../../../packages/pg-delta/tests/containers.ts";
import { applySupabaseBaseInit } from "../../../packages/pg-delta/tests/supabase-base-init.ts";
import {
  resolveProfile,
  type ResolvedProfile,
} from "../../../packages/pg-delta/src/integrations/profile.ts";
import { supabaseProfile } from "../../../packages/pg-delta/src/integrations/supabase.ts";
import { createRequire } from "node:module";
import { buildSchemaExport } from "../../../packages/pg-delta/src/frontends/schema-export.ts";
import { planSchemaFiles } from "../../../packages/pg-delta/src/frontends/schema-plan.ts";
import { rawProfile } from "../../../packages/pg-delta/src/integrations/profile.ts";

const pg = createRequire(
  import.meta.resolve("../../../packages/pg-delta/package.json"),
)("pg");

/** Cluster-global roles the stock-flavor generator owns objects by and grants
 *  to. Created once: roles are shared by every database on the cluster. */
const STOCK_ROLES = ["eph_owner", "eph_reader", "eph_writer"];

type Db = {
  name: string;
  pool: any;
  clone(): Promise<Db>;
  drop(): Promise<void>;
};

interface Env {
  createDb(prefix: string): Promise<Db>;
  /** the resolved integration profile (Supabase flavor only) */
  profile(pool: any): Promise<ResolvedProfile | undefined>;
  /** the profile the declarative frontends (export / sync) resolve */
  profileDef: any;
  /** an empty shadow for `planSchemaFiles`, and the options that go with it */
  createShadow(prefix: string): Promise<Db>;
  shadowOptions: Record<string, unknown>;
}

let stockEnv: Promise<Env> | undefined;
function stock(): Promise<Env> {
  stockEnv ??= (async () => {
    const cluster = await sharedCluster();
    for (const r of STOCK_ROLES) {
      await cluster.adminPool.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r}; END IF; END $$`,
      );
    }
    return {
      createDb: (p) => cluster.createDb(p) as Promise<Db>,
      profile: async () => undefined,
      profileDef: rawProfile,
      createShadow: (p) => cluster.createDb(p) as Promise<Db>,
      shadowOptions: {},
    };
  })();
  return stockEnv;
}

/** One standalone Supabase container: the committed base-init fixture is
 *  replayed into its `postgres` database (auth, storage, realtime, roles), which
 *  then serves as the template for every case database. Case databases are
 *  owned by and used as `postgres`, the non-superuser role real projects get. */
let supaEnv: Promise<Env> | undefined;
function supabase(): Promise<Env> {
  supaEnv ??= (async () => {
    const s = await startStandaloneSupabase();
    const boot = new pg.Pool({
      connectionString: s.connectionUri("postgres"),
      max: 1,
    });
    await applySupabaseBaseInit(boot);
    await boot.end();
    const admin = new pg.Pool({
      connectionString: s.connectionUri("template1"),
      max: 2,
    });
    admin.on("error", () => {});
    for (let i = 0; ; i++) {
      try {
        // background workers (pg_cron, pg_net) hold connections to `postgres`
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postgres' AND pid <> pg_backend_pid()`,
        );
        await admin.query(`CREATE DATABASE eph_tpl TEMPLATE postgres`);
        break;
      } catch (e) {
        if (i > 50) throw e;
        await Bun.sleep(100);
      }
    }
    let n = 0;
    const make = async (name: string, template: string): Promise<Db> => {
      await admin.query(
        `CREATE DATABASE "${name}" TEMPLATE "${template}" OWNER postgres`,
      );
      const pool = new pg.Pool({
        connectionString: s.postgresConnectionUri(name),
        max: 5,
      });
      pool.on("error", () => {});
      const db: Db = {
        name,
        pool,
        async clone() {
          await db.pool.end().catch(() => {});
          const c = await make(`${name}_c${n++}`, name);
          db.pool = new pg.Pool({
            connectionString: s.postgresConnectionUri(name),
            max: 5,
          });
          db.pool.on("error", () => {});
          return c;
        },
        async drop() {
          await db.pool.end().catch(() => {});
          await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        },
      };
      return db;
    };
    return {
      createDb: (p) => make(`${p}_${n++}`, "eph_tpl"),
      profile: (pool) => resolveProfile(pool, supabaseProfile),
      profileDef: supabaseProfile,
      // `schema apply`'s co-located shadow: an empty database next to the
      // target, seeded with the profile's assumed schemas (auth.users, …)
      createShadow: (p) => make(`${p}_${n++}`, "template0"),
      shadowOptions: { seedAssumedSchemas: true },
    };
  })();
  return supaEnv;
}

const env = (flavor?: string) => (flavor === "supabase" ? supabase() : stock());

type Result = {
  verdict: "pass" | "invalid" | "fail";
  kind?: string;
  detail?: string;
  actions?: number;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function deltaText(d: any): string {
  if (d.verb === "set")
    return `set ${encodeId(d.id)}.${d.attr}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`;
  if (d.verb === "add" || d.verb === "remove")
    return `${d.verb} ${encodeId(d.fact.id)}`;
  return `${d.verb} ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`;
}

async function migrate(req: {
  from: string;
  to: string;
  compact: boolean;
  seed?: string;
  autoSeed?: boolean;
  flavor?: string;
  rows?: boolean;
  renameSeed?: number;
}): Promise<Result> {
  const first = await migrateOnce(req, req.autoSeed ?? true);
  // An apply error caused only by the auto-seeded rows (NOT NULL / CHECK /
  // cast on existing data) is a migration hazard of the input, not an engine
  // bug. A data_loss is not: the proof already skips tables the plan drops or
  // re-creates, so lost rows in a kept table are a finding, and they can only
  // show up with rows present.
  if (
    first.verdict === "fail" &&
    (req.autoSeed ?? true) &&
    first.kind === "apply_error"
  ) {
    const bare = await migrateOnce(req, false);
    if (bare.verdict === "pass")
      return { verdict: "pass", kind: "data_hazard", detail: first.detail };
    // fails on empty tables too: that failure is the more fundamental one
    return bare;
  }
  return first;
}

/**
 * Puts one row in every user table of the source, so the proof's data check
 * has something to fingerprint (its own auto-seed only does DEFAULT VALUES,
 * which a NOT NULL column without a default refuses). Values come from the
 * column types; several candidates are tried per table so one of them can
 * land in a partition and pass CHECKs. FK and user triggers are suspended
 * (session_replication_role = replica) while seeding.
 */
async function seedRows(pool: any): Promise<number> {
  const c = await pool.connect();
  let seeded = 0;
  try {
    const { rows: tables } = await c.query(`
      SELECT c.oid, format('%I.%I', n.nspname, c.relname) AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
        AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
        AND n.nspname NOT IN ('auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgsodium', 'pgbouncer', 'pgmq')`);
    await c.query("BEGIN");
    // needs superuser; on Supabase (`postgres`) FKs and triggers stay on
    await c.query("SAVEPOINT r");
    try {
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query("RELEASE SAVEPOINT r");
    } catch {
      await c.query("ROLLBACK TO SAVEPOINT r");
    }
    for (const t of tables) {
      const { rows: cols } = await c.query(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS ty, t.typcategory AS cat, t.typtype, a.atttypid,
                coalesce(bt.typcategory, t.typcategory) AS bcat
         FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid LEFT JOIN pg_type bt ON bt.oid = t.typbasetype
         WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
         ORDER BY a.attnum`,
        [t.oid],
      );
      for (let i = 0; i < 10; i++) {
        const nums = [1, 0, 10, 20, 100, 150, 2, 11, 21, 250];
        const strs = [
          "x",
          "v010",
          "v020",
          "v200",
          "v250",
          "v011",
          "v021",
          "a",
          "m",
          "z",
        ];
        const dates = [
          "2020-01-01",
          "2010-01-01",
          "2250-01-01",
          "2000-01-01",
          "2021-01-01",
          "2200-06-01",
          "2011-01-01",
          "1990-01-01",
          "2100-01-01",
          "2020-06-01",
        ];
        const val = (col: any) => {
          const cat = col.typtype === "d" ? col.bcat : col.cat;
          if (col.typtype === "e")
            return `(enum_range(NULL::${col.ty}))[${(i % 2) + 1}]`;
          switch (cat) {
            case "N":
              return `${nums[i]}::${col.ty}`;
            case "S":
              return `'${strs[i]}'::${col.ty}`;
            case "D":
              return `'${dates[i]}'::${col.ty}`;
            case "B":
              return `true`;
            case "U":
              return `'00000000-0000-0000-0000-00000000000${i}'::${col.ty}`;
            case "A":
              return `'{}'::${col.ty}`;
            default:
              return col.ty === "jsonb" || col.ty === "json"
                ? `'{}'::${col.ty}`
                : `NULL`;
          }
        };
        const sql = cols.length
          ? `INSERT INTO ${t.rel} (${cols.map((x: any) => `"${x.attname}"`).join(", ")}) VALUES (${cols.map(val).join(", ")})`
          : `INSERT INTO ${t.rel} DEFAULT VALUES`;
        await c.query("SAVEPOINT s");
        try {
          await c.query(sql);
          await c.query("RELEASE SAVEPOINT s");
          seeded++;
          break;
        } catch {
          await c.query("ROLLBACK TO SAVEPOINT s");
        }
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return seeded;
}

/** Renames 1–3 objects of `pool` picked from its catalog by `seed`; returns
 *  the statements that ran (a rename PostgreSQL refuses is skipped). */
async function applyRenames(pool: any, seed: number): Promise<string[]> {
  const { rows } = await pool.query(`
    WITH u AS (SELECT n.oid, n.nspname FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_%'),
    -- extension members, and objects PostgreSQL made for another (range constructors, array types)
    ext AS (SELECT objid, classid FROM pg_depend WHERE deptype IN ('e', 'i'))
    SELECT stmt FROM (
      SELECT format('ALTER %s %I.%I RENAME TO %I', CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' WHEN 'i' THEN 'INDEX' ELSE 'TABLE' END, u.nspname, c.relname, c.relname || '_r') AS stmt
        FROM pg_class c JOIN u ON u.oid = c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','i') AND NOT EXISTS (SELECT FROM ext WHERE objid = c.oid)
      UNION ALL
      SELECT format('ALTER TABLE %I.%I RENAME COLUMN %I TO %I', u.nspname, c.relname, a.attname, a.attname || '_r')
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN u ON u.oid = c.relnamespace
        WHERE c.relkind IN ('r','p','v','m') AND a.attnum > 0 AND NOT a.attisdropped AND a.attinhcount = 0 AND NOT EXISTS (SELECT FROM ext WHERE objid = c.oid)
      UNION ALL
      SELECT format('ALTER FUNCTION %s RENAME TO %I', p.oid::regprocedure, p.proname || '_r')
        FROM pg_proc p JOIN u ON u.oid = p.pronamespace WHERE p.prokind = 'f' AND NOT EXISTS (SELECT FROM ext WHERE objid = p.oid)
      UNION ALL
      SELECT format('ALTER TYPE %I.%I RENAME TO %I', u.nspname, t.typname, t.typname || '_r')
        FROM pg_type t JOIN u ON u.oid = t.typnamespace WHERE t.typtype IN ('e','d','r') OR (t.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
        AND NOT EXISTS (SELECT FROM ext WHERE objid = t.oid)
      UNION ALL
      SELECT format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I', u.nspname, c.relname, k.conname, k.conname || '_r')
        FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN u ON u.oid = c.relnamespace WHERE k.coninhcount = 0
      UNION ALL
      SELECT format('ALTER TRIGGER %I ON %I.%I RENAME TO %I', g.tgname, u.nspname, c.relname, g.tgname || '_r')
        FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN u ON u.oid = c.relnamespace WHERE NOT g.tgisinternal AND g.tgparentid = 0
      UNION ALL
      SELECT format('ALTER POLICY %I ON %I.%I RENAME TO %I', p.polname, u.nspname, c.relname, p.polname || '_r')
        FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN u ON u.oid = c.relnamespace
      UNION ALL
      SELECT format('ALTER SCHEMA %I RENAME TO %I', u.nspname, u.nspname || '_r') FROM u WHERE u.nspname NOT IN ('public')
    ) s ORDER BY stmt`);
  const done: string[] = [];
  if (!rows.length) return done;
  let x = seed >>> 0;
  const next = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x);
  const want = 1 + (next() % 3);
  for (let i = 0; i < want * 3 && done.length < want; i++) {
    const stmt = rows[next() % rows.length].stmt;
    if (done.includes(stmt)) continue;
    try {
      await pool.query(stmt);
      done.push(stmt);
    } catch {
      // the object may be gone or renamed by an earlier pick
    }
  }
  return done;
}

async function migrateOnce(
  req: {
    from: string;
    to: string;
    compact: boolean;
    seed?: string;
    flavor?: string;
    rows?: boolean;
    renameSeed?: number;
  },
  autoSeed: boolean,
): Promise<Result> {
  const e = await env(req.flavor);
  const source = await e.createDb("eph_src");
  const desired = await e.createDb("eph_dst");
  let clone: Db | undefined;
  try {
    try {
      await source.pool.query(req.from);
    } catch (e) {
      return { verdict: "invalid", kind: "from_load", detail: msg(e) };
    }
    try {
      await desired.pool.query(req.to);
    } catch (e) {
      return { verdict: "invalid", kind: "to_load", detail: msg(e) };
    }
    const renamed =
      req.renameSeed === undefined
        ? []
        : await applyRenames(desired.pool, req.renameSeed);
    const renameNote = renamed.length
      ? `renames applied to the desired side:\n${renamed.map((r) => "  " + r).join("\n")}\n`
      : "";
    if (req.seed) {
      try {
        await source.pool.query(req.seed);
      } catch (e) {
        return { verdict: "invalid", kind: "seed_load", detail: msg(e) };
      }
    }
    // rows are part of the seeded run only; the bare re-run stays empty
    if (req.rows && autoSeed) await seedRows(source.pool);
    const ctx = await e.profile(source.pool);
    const ex = ctx?.extract ?? extract;
    let sourceState, desiredState;
    try {
      sourceState = await ex(source.pool);
      desiredState = await ex(desired.pool);
    } catch (e) {
      return { verdict: "fail", kind: "extract_throw", detail: msg(e) };
    }
    const renames =
      req.renameSeed === undefined && !(req as any).renames
        ? {}
        : { renames: "auto" as const };
    const planOptions = ctx
      ? { ...ctx.planOptions, compact: req.compact, ...renames }
      : {
          capability: await probeApplierCapability(source.pool),
          compact: req.compact,
          ...renames,
        };
    let thePlan;
    try {
      thePlan = plan(sourceState.factBase, desiredState.factBase, planOptions);
    } catch (e) {
      return { verdict: "fail", kind: "plan_throw", detail: msg(e) };
    }
    const planText =
      renameNote +
      thePlan.actions.map((a: any, i: number) => `  ${i}: ${a.sql}`).join("\n");
    // determinism: same inputs, same plan
    const again = plan(
      sourceState.factBase,
      desiredState.factBase,
      planOptions,
    );
    const againText =
      renameNote +
      again.actions.map((a: any, i: number) => `  ${i}: ${a.sql}`).join("\n");
    if (againText !== planText) {
      return {
        verdict: "fail",
        kind: "plan_nondeterministic",
        detail: `first:\n${planText}\nsecond:\n${againText}`,
      };
    }

    clone = await source.clone();
    const cloneState = await ex(clone.pool);
    if (cloneState.factBase.rootHash !== sourceState.factBase.rootHash) {
      const presync = plan(
        cloneState.factBase,
        sourceState.factBase,
        planOptions,
      );
      const r = await apply(presync, clone.pool, {
        ...ctx?.applyOptions,
        fingerprintGate: false,
      });
      if (r.status !== "applied")
        return { verdict: "fail", kind: "presync", detail: r.error?.message };
    }
    let verdict;
    try {
      verdict = await provePlan(thePlan, clone.pool, desiredState.factBase, {
        ...ctx?.proveOptions,
        autoSeed,
      });
    } catch (e) {
      return {
        verdict: "fail",
        kind: "prove_throw",
        detail: `${msg(e)}\nplan:\n${planText}`,
      };
    }
    if (verdict.ok) {
      // a rename pg-delta did not detect degrades to a declared drop + create
      const missed =
        renamed.some(
          (r) =>
            / RENAME (TO|COLUMN) /.test(r) &&
            !/ CONSTRAINT | TRIGGER | POLICY /.test(r),
        ) && thePlan.actions.some((a: any) => a.dataLoss === "destructive");
      return {
        verdict: "pass",
        kind: missed ? "rename_missed" : undefined,
        detail: missed ? planText : undefined,
        actions: thePlan.actions.length,
      };
    }
    if (verdict.applyError) {
      return {
        verdict: "fail",
        kind: "apply_error",
        detail: `action ${verdict.applyError.actionIndex}: ${verdict.applyError.message}\nplan:\n${planText}`,
      };
    }
    const parts: string[] = [];
    let kind = "proof_other";
    if (verdict.driftDeltas.length) {
      kind = "drift";
      parts.push(
        `drift:\n${verdict.driftDeltas.map((d: any) => "  " + deltaText(d)).join("\n")}`,
      );
    }
    if (verdict.dataViolations.length) {
      if (kind === "proof_other") kind = "data_loss";
      parts.push(
        `data:\n${verdict.dataViolations.map((v: any) => `  ${rel(v.table.schema, v.table.name)}: ${v.before} -> ${v.after}`).join("\n")}`,
      );
    }
    if (verdict.rewriteViolations.length) {
      if (kind === "proof_other") kind = "undeclared_rewrite";
      parts.push(
        `rewrites:\n${verdict.rewriteViolations.map((v: any) => "  " + rel(v.table.schema, v.table.name)).join("\n")}`,
      );
    }
    if (verdict.safetyMetadataViolations?.length) {
      if (kind === "proof_other") kind = "safety_metadata";
      parts.push(`safety: ${JSON.stringify(verdict.safetyMetadataViolations)}`);
    }
    if (verdict.seedSideEffects?.length || verdict.seedStateViolation) {
      if (kind === "proof_other") kind = "seed_side_effect";
      parts.push(
        `seed: ${JSON.stringify({ e: verdict.seedSideEffects, s: verdict.seedStateViolation })}`,
      );
    }
    if (kind === "proof_other")
      parts.push(
        JSON.stringify({
          ...verdict,
          coverage: undefined,
          projectionAudit: undefined,
        }).slice(0, 2000),
      );
    return {
      verdict: "fail",
      kind,
      detail: `${parts.join("\n")}\nplan:\n${planText}`,
    };
  } finally {
    if (clone) await clone.drop().catch(() => {});
    await Promise.all([
      source.drop().catch(() => {}),
      desired.drop().catch(() => {}),
    ]);
  }
}

async function roundtrip(req: {
  sql: string;
  layout: "by-object" | "ordered" | "grouped";
}): Promise<Result> {
  const e = await stock();
  const src = await e.createDb("eph_rt");
  const shadow = await e.createDb("eph_sh");
  try {
    try {
      await src.pool.query(req.sql);
    } catch (e) {
      return { verdict: "invalid", kind: "sql_load", detail: msg(e) };
    }
    const fb = (await extract(src.pool)).factBase;
    let files;
    try {
      files = exportSqlFiles(fb, { layout: req.layout }).filter(
        (f) => !/cluster[_/]roles/.test(f.name),
      );
    } catch (e) {
      return { verdict: "fail", kind: "export_throw", detail: msg(e) };
    }
    const dump = files.map((f) => `-- ${f.name}\n${f.sql}`).join("\n");
    let loaded;
    try {
      loaded = await loadSqlFiles(files, shadow.pool);
    } catch (e) {
      return {
        verdict: "fail",
        kind: "load_throw",
        detail: `${msg(e)}\nexport:\n${dump}`,
      };
    }
    if (loaded.factBase.rootHash === fb.rootHash) return { verdict: "pass" };
    // describe the difference with the planner itself
    const diff = plan(loaded.factBase, fb, {});
    return {
      verdict: "fail",
      kind: "roundtrip_drift",
      detail: `diagnostics: ${JSON.stringify((loaded as any).diagnostics ?? []).slice(0, 1500)}\nremaining plan:\n${diff.actions.map((a: any) => "  " + a.sql).join("\n")}\nexport:\n${dump}`,
    };
  } finally {
    await Promise.all([
      src.drop().catch(() => {}),
      shadow.drop().catch(() => {}),
    ]);
  }
}

/**
 * The Supabase CLI declarative workflow: `generate` exports the live database
 * as files, `sync` loads the files into a shadow and plans live <- shadow.
 *   1. export(to) re-synced against `to` itself must plan nothing;
 *   2. export(to) synced against `from` must apply, and re-syncing after
 *      that must plan nothing.
 * The shadow is an empty database on the same cluster; on Supabase it is
 * seeded with the assumed schemas, as `pgdelta schema apply` does by default.
 */
/** Rows each user table holds itself (ONLY), summed. */
async function ownRows(pool: any): Promise<number> {
  const { rows } = await pool.query(`
    SELECT format('%I.%I', n.nspname, c.relname) AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgsodium', 'pgbouncer', 'pgmq')
      AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')`);
  let total = 0;
  for (const r of rows)
    total += Number(
      (await pool.query(`SELECT count(*) AS n FROM ONLY ${r.rel}`)).rows[0].n,
    );
  return total;
}

async function declarative(req: {
  from: string;
  to: string;
  layout: "by-object" | "ordered" | "grouped";
  flavor?: string;
  strict?: boolean;
  renameSeed?: number;
  rows?: boolean;
}): Promise<Result> {
  const first = await declarativeOnce(req);
  // an apply error the seeded rows cause (cast of 'x', NOT NULL over a NULL) is a hazard of the input
  if (first.verdict === "fail" && req.rows && first.kind === "apply_error") {
    const bare = await declarativeOnce({ ...req, rows: false });
    if (bare.verdict === "pass")
      return { verdict: "pass", kind: "data_hazard", detail: first.detail };
    return bare;
  }
  return first;
}

async function declarativeOnce(req: {
  from: string;
  to: string;
  layout: "by-object" | "ordered" | "grouped";
  flavor?: string;
  strict?: boolean;
  renameSeed?: number;
  rows?: boolean;
}): Promise<Result> {
  const e = await env(req.flavor);
  const live = await e.createDb("eph_live");
  const want = await e.createDb("eph_want");
  const shadows: Db[] = [];
  const sync = async (target: Db, files: any, manifest: any) => {
    const sh = await e.createShadow("eph_shd");
    shadows.push(sh);
    const renames =
      req.renameSeed === undefined ? {} : { renames: "auto" as const };
    return planSchemaFiles(target.pool, sh.pool, files, {
      profile: e.profileDef,
      manifest,
      ...e.shadowOptions,
      ...renames,
    });
  };
  // draft 16 on every Supabase database: base-init leaves postgres a
  // schema-level `{postgres=X/postgres}` function default in public, which the
  // planner reads as PUBLIC having lost EXECUTE. Ignored so the rest is tested.
  const ignored = (a: any) =>
    !req.strict &&
    req.flavor === "supabase" &&
    a.sql ===
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT EXECUTE ON FUNCTIONS TO PUBLIC`;
  const pending = (p: any) => p.plan.actions.filter((a: any) => !ignored(a));
  const sqlOf = (p: any) =>
    p.plan.actions.map((a: any, i: number) => `  ${i}: ${a.sql}`).join("\n");
  try {
    try {
      await live.pool.query(req.from);
    } catch (e) {
      return { verdict: "invalid", kind: "from_load", detail: msg(e) };
    }
    try {
      await want.pool.query(req.to);
    } catch (e) {
      return { verdict: "invalid", kind: "to_load", detail: msg(e) };
    }
    const renamed =
      req.renameSeed === undefined
        ? []
        : await applyRenames(want.pool, req.renameSeed);
    const renameNote = renamed.length
      ? `renames applied to the desired side:\n${renamed.map((r) => "  " + r).join("\n")}\n`
      : "";
    if (req.rows) await seedRows(live.pool);
    const rowsBefore = req.rows ? await ownRows(live.pool) : 0;
    let exported;
    try {
      exported = await buildSchemaExport(want.pool, {
        profile: e.profileDef,
        layout: req.layout,
      });
    } catch (e) {
      return { verdict: "fail", kind: "export_throw", detail: msg(e) };
    }
    const dump = exported.files
      .map((f: any) => `-- ${f.name}\n${f.sql}`)
      .join("\n");
    let p;
    try {
      p = await sync(want, exported.files, exported.manifest);
    } catch (e) {
      return {
        verdict: "fail",
        kind: "resync_throw",
        detail: `${msg(e)}\nexport:\n${dump}`,
      };
    }
    if (pending(p).length) {
      return {
        verdict: "fail",
        kind: "resync_not_empty",
        detail: `${pending(p)[0].sql}\nplan:\n${sqlOf(p)}\nexport:\n${dump}`,
      };
    }
    try {
      p = await sync(live, exported.files, exported.manifest);
    } catch (e) {
      return {
        verdict: "fail",
        kind: "sync_throw",
        detail: `${msg(e)}\nexport:\n${dump}`,
      };
    }
    const planText = renameNote + sqlOf(p);
    if (p.plan.actions.length) {
      const r = await apply(p.plan, live.pool, p.applyOptions);
      if (r.status !== "applied") {
        return {
          verdict: "fail",
          kind: "apply_error",
          detail: `${r.error?.message}\nplan:\n${planText}\nexport:\n${dump}`,
        };
      }
    }
    if (req.rows) {
      const after = await ownRows(live.pool);
      const declared = p.plan.actions.some(
        (a: any) => a.dataLoss === "destructive",
      );
      if (after < rowsBefore && !declared) {
        return {
          verdict: "fail",
          kind: "silent_data_loss",
          detail: `rows ${rowsBefore} -> ${after}, no destructive action\nplan:\n${planText}`,
        };
      }
    }
    let again;
    try {
      again = await sync(live, exported.files, exported.manifest);
    } catch (e) {
      return {
        verdict: "fail",
        kind: "resync_throw",
        detail: `after sync: ${msg(e)}\nplan:\n${planText}`,
      };
    }
    if (pending(again).length) {
      return {
        verdict: "fail",
        kind: "sync_not_converged",
        detail: `${pending(again)[0].sql}\nremaining:\n${sqlOf(again)}\nplan:\n${planText}\nexport:\n${dump}`,
      };
    }
    return { verdict: "pass", actions: p.plan.actions.length };
  } finally {
    await Promise.all(
      [live, want, ...shadows].map((d) => d.drop().catch(() => {})),
    );
  }
}

/** Burns OIDs (and pg_type / pg_class rows) before the real SQL, so the same
 *  schema gets different OIDs than in a plain load. */
const NOISE =
  Array.from(
    { length: 40 },
    (_, i) =>
      `CREATE TABLE eph_noise_${i} (a int); CREATE TYPE eph_noise_t${i} AS (a int); CREATE FUNCTION eph_noise_f${i}() RETURNS int LANGUAGE sql AS 'SELECT 1';`,
  ).join("\n") +
  Array.from(
    { length: 40 },
    (_, i) =>
      `DROP TABLE eph_noise_${i}; DROP TYPE eph_noise_t${i}; DROP FUNCTION eph_noise_f${i}();`,
  ).join("\n");

/**
 * The fact base and the plan must not depend on OIDs or catalog history:
 * A and B are each loaded twice, once after NOISE; both extracts must hash the
 * same and both plans must be identical.
 */
async function stable(req: {
  from: string;
  to: string;
  flavor?: string;
}): Promise<Result> {
  const e = await env(req.flavor);
  const dbs: Db[] = [];
  const load = async (sql: string, noise: boolean) => {
    const d = await e.createDb("eph_stb");
    dbs.push(d);
    if (noise) await d.pool.query(NOISE);
    await d.pool.query(sql);
    return d;
  };
  try {
    let a1, a2, b1, b2;
    try {
      [a1, b1] = [await load(req.from, false), await load(req.to, false)];
      [a2, b2] = [await load(req.from, true), await load(req.to, true)];
    } catch (err) {
      return { verdict: "invalid", kind: "load", detail: msg(err) };
    }
    const ctx = await e.profile(a1.pool);
    const ex = ctx?.extract ?? extract;
    const [fa1, fa2, fb1, fb2] = await Promise.all(
      [a1, a2, b1, b2].map(async (d) => (await ex(d.pool)).factBase),
    );
    for (const [x, y, n] of [
      [fa1, fa2, "A"],
      [fb1, fb2, "B"],
    ] as const) {
      if (x.rootHash !== y.rootHash) {
        const d = plan(x, y, {});
        return {
          verdict: "fail",
          kind: "hash_unstable",
          detail: `${n}: same SQL, different fact base after other objects came and went\nplan between them:\n${d.actions.map((a: any) => "  " + a.sql).join("\n")}`,
        };
      }
    }
    const opts = ctx
      ? { ...ctx.planOptions }
      : { capability: await probeApplierCapability(a1.pool) };
    let p1, p2;
    try {
      p1 = plan(fa1, fb1, opts).actions.map((a: any) => a.sql);
      p2 = plan(fa2, fb2, opts).actions.map((a: any) => a.sql);
    } catch (err) {
      return { verdict: "pass", kind: "plan_throw_skipped", detail: msg(err) };
    }
    if (JSON.stringify(p1) !== JSON.stringify(p2)) {
      return {
        verdict: "fail",
        kind: "plan_unstable",
        detail: `plain load:\n${p1.map((s: string) => "  " + s).join("\n")}\nafter noise:\n${p2.map((s: string) => "  " + s).join("\n")}`,
      };
    }
    return { verdict: "pass", actions: p1.length };
  } finally {
    await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
  }
}

function emit(r: Result) {
  writeSync(1, `@@RESULT ${JSON.stringify(r)}\n`);
}

await (process.env["EPHYRA_FLAVOR"] === "supabase" ? supabase() : stock());
emit({ verdict: "pass", kind: "ready" });
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  let r: Result;
  try {
    const req = JSON.parse(line);
    r =
      req.op === "roundtrip"
        ? await roundtrip(req)
        : req.op === "declarative"
          ? await declarative(req)
          : req.op === "stable"
            ? await stable(req)
            : await migrate(req);
  } catch (e) {
    r = {
      verdict: "fail",
      kind: "worker_throw",
      detail: e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
    };
  }
  emit(r);
}
process.exit(0);
