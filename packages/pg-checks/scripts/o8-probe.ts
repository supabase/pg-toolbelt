/**
 * O8 probe: runs the check block against a HOSTED (staging) Supabase project
 * through the direct connection, Supavisor (transaction + session) and the
 * Management API query endpoint. Appends one section per cell to REPORT.md.
 *
 *   O8_DIR=<report dir>  (reads <dir>/.env: PGPASSWORD, REF)
 *   SUPABASE_ACCESS_TOKEN, O8_API (default https://api.supabase.green)
 *   O8_DB_HOST (db.<ref>.supabase.red), O8_POOLER_HOST
 *   bun scripts/o8-probe.ts [direct|pooler|logs|mgmt|all]
 *
 * Secrets are read from the environment / the report dir only and never written
 * to the report.
 */
import { appendFileSync, readFileSync } from "node:fs";
import pg from "pg";
import {
  buildAfterCommitRead,
  buildCheckBlock,
  parseCheckError,
  resolvePolicy,
} from "../src/index.ts";
import { applyMigrationLikeCli, runBatch } from "../tests/cli-executor.ts";
import { buildCheckStatements } from "../src/index.ts";

const dir = process.env["O8_DIR"];
if (!dir) throw new Error("O8_DIR is required");
const env = Object.fromEntries(
  readFileSync(`${dir}/.env`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const REF = env["REF"] as string;
const PASSWORD = env["PGPASSWORD"] as string;
const API = process.env["O8_API"] ?? "https://api.supabase.green";
if (API.includes("supabase.com")) throw new Error("refusing prod API");
const TOKEN = process.env["SUPABASE_ACCESS_TOKEN"] ?? "";
const DB_HOST = process.env["O8_DB_HOST"] ?? `db.${REF}.supabase.red`;
const POOLER_HOST =
  process.env["O8_POOLER_HOST"] ?? "aws-0-us-east-1.pooler.supabase.green";

const log = (text: string) => {
  appendFileSync(`${dir}/REPORT.md`, `${text}\n`);
  console.log(text);
};

const connect = async (host: string, port: number, user: string) => {
  const client = new pg.Client({
    host,
    port,
    user,
    password: PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  return client;
};

const direct = () => connect(DB_HOST, 5432, "postgres");
const poolerTx = () => connect(POOLER_HOST, 6543, `postgres.${REF}`);
const poolerSession = () => connect(POOLER_HOST, 5432, `postgres.${REF}`);

const rlsError = resolvePolicy({ rls_disabled_in_public: "error" });
const allError = resolvePolicy(
  Object.fromEntries(
    [
      "rls_disabled_in_public",
      "rls_enabled_no_policy",
      "policy_exists_rls_disabled",
      "security_definer_view",
      "rls_policy_always_true",
      "sensitive_columns_exposed",
      "auth_users_exposed",
      "function_search_path_mutable",
      "rls_references_user_metadata",
    ].map((r) => [r, "error"]),
  ),
);

let seq = 0;
const version = () => `${20261021000000 + ++seq}`;
const exists = async (c: pg.Client, rel: string) =>
  (await c.query("select pg_catalog.to_regclass($1) is not null as ok", [rel]))
    .rows[0].ok as boolean;
const historyRows = async (c: pg.Client, v: string) =>
  Number(
    (
      await c.query(
        "select count(*) from supabase_migrations.schema_migrations where version = $1",
        [v],
      )
    ).rows[0].count,
  );

const blockedFile = (table: string) => [
  `create table public.${table} (id int primary key)`,
  `grant select on public.${table} to anon`,
];
const secureFile = (table: string) => [
  `create table public.${table} (id int primary key)`,
  `alter table public.${table} enable row level security`,
];

async function cellBlocked(c: pg.Client, label: string, table: string) {
  const v = version();
  const r = await applyMigrationLikeCli(
    c,
    { version: v, name: table, statements: blockedFile(table) },
    rlsError,
  );
  const names =
    r.outcome === "blocked"
      ? r.check.kind === "blocked"
        ? r.check.errors.map((e) => `${e.name}:${e.rule ?? ""}`)
        : []
      : [];
  const tableThere = await exists(c, `public.${table}`);
  const hist = await historyRows(c, v);
  const pass =
    r.outcome === "blocked" && !tableThere && hist === 0 && names.length > 0;
  log(
    `- ${label}: **${pass ? "PASS" : "FAIL"}** outcome=${r.outcome} ms=${r.ms} table_present=${tableThere} history_rows=${hist} errors=${JSON.stringify(names)}${r.outcome === "apply_error" ? ` error=${r.error.message} code=${r.error.code}` : ""}`,
  );
  return pass;
}

const SETTINGS = `select pg_catalog.current_setting('statement_timeout') as st, pg_catalog.current_setting('search_path') as sp, pg_catalog.current_setting('pgrst.db_schemas', true) as pgrst, pg_catalog.current_setting('sbc.statement_timeout', true) as sbc`;

/** Secure file with its own SET LOCALs; observe values after the check, inside the tx. */
async function cellSecureRestore(c: pg.Client, label: string) {
  const v = version();
  await c.query("RESET ALL");
  const stmts = [
    "create table public.o8_obs (k text, st text, sp text, pgrst text, sbc text)",
    "alter table public.o8_obs enable row level security",
    "set local statement_timeout = '7s'",
    "set local search_path = public, extensions",
    "create table public.o8_secure (id int primary key)",
    "alter table public.o8_secure enable row level security",
    `insert into public.o8_obs select 'before-check', st, sp, pgrst, sbc from (${SETTINGS}) s`,
  ];
  const check = buildCheckStatements(rlsError, {});
  const ops = [
    ...stmts.map((sql) => ({ sql })),
    ...check.map((sql) => ({ sql })),
    {
      sql: `insert into public.o8_obs select 'after-check', st, sp, pgrst, sbc from (${SETTINGS}) s`,
    },
    {
      sql: "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)",
      params: [v, "o8_secure", ["x"]],
    },
  ];
  const t = performance.now();
  await runBatch(c, ops);
  const ms = Math.round(performance.now() - t);
  const rows = (await c.query("select * from public.o8_obs order by k")).rows;
  const after = rows.find((r) => r.k === "after-check");
  const before = rows.find((r) => r.k === "before-check");
  const pass =
    after.st === "7s" &&
    after.sp === "public, extensions" &&
    before.st === "7s" &&
    (await historyRows(c, v)) === 1;
  log(
    `- ${label}: **${pass ? "PASS" : "FAIL"}** ms=${ms} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  await c.query("RESET ALL");
  await c.query("drop table public.o8_obs, public.o8_secure");
  await c.query(
    "delete from supabase_migrations.schema_migrations where version = $1",
    [v],
  );
  return pass;
}

async function cellTimeout(c: pg.Client, label: string, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const v = version();
    const table = `o8_to_${i}`;
    const r = await applyMigrationLikeCli(
      c,
      { version: v, name: table, statements: blockedFile(table) },
      rlsError,
      { timeoutMs: 1 },
    );
    const sqlstate =
      r.outcome === "apply_error"
        ? r.error.code
        : r.outcome === "timed_out"
          ? "SB002"
          : "SB001";
    const gone = !(await exists(c, `public.${table}`));
    const hist = await historyRows(c, v);
    log(
      `- ${label} try ${i + 1} (timeoutMs=1): outcome=${r.outcome} sqlstate=${sqlstate} ms=${r.ms} table_absent=${gone} history_rows=${hist}${r.outcome === "apply_error" ? ` msg=${r.error.message}` : ""}`,
    );
  }
}

async function runDirect() {
  log("\n## Cell 1: direct connection as postgres\n");
  const c = await direct();
  const rtt = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await c.query("select 1");
    rtt.push(Math.round(performance.now() - t));
  }
  log(`- client RTT (select 1, ms): ${rtt.join(",")}`);
  const base = (await c.query("select version()")).rows[0].version;
  log(`- ${base}`);
  const pre = parseFindingsSafe(
    (
      await (async () => {
        const read = buildAfterCommitRead(allError, {});
        let rows: unknown[] = [];
        for (const [i, sql] of read.statements.entries()) {
          const res = await c.query(sql);
          if (i === read.resultIndex) rows = res.rows;
        }
        return { rows };
      })()
    ).rows,
  );
  log(`- baseline findings on empty project, all rules, public: ${pre}`);
  await cellBlocked(
    c,
    "1a rls_disabled_in_public + grant anon blocked",
    "o8_a",
  );
  // 1b via the plain executor too
  const v = version();
  const r = await applyMigrationLikeCli(
    c,
    { version: v, name: "o8_b", statements: secureFile("o8_b") },
    rlsError,
  );
  log(
    `- 1b plain secure apply: outcome=${r.outcome} ms=${r.ms} table=${await exists(c, "public.o8_b")} history=${await historyRows(c, v)}`,
  );
  await c.query("drop table public.o8_b");
  await c.query(
    "delete from supabase_migrations.schema_migrations where version=$1",
    [v],
  );
  await cellSecureRestore(c, "1b secure + file's own SET LOCALs restored");
  await cellTimeout(c, "1c");
  // 1d: set_config on sbc.* under supautils, plus a few non-sbc names
  await c.query("begin");
  const sbc = await c.query(
    "select pg_catalog.set_config('sbc.statement_timeout','5',true) as v",
  );
  await c.query("rollback");
  log(
    `- 1d set_config('sbc.*', true) as postgres: **${sbc.rows[0].v === "5" ? "PASS" : "FAIL"}**`,
  );
  // durations: secure applies with and without checks
  const t = (n: number, skip: boolean) => async () => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const vv = version();
      const res = await applyMigrationLikeCli(
        c,
        { version: vv, name: "o8_d", statements: secureFile("o8_d") },
        rlsError,
        { skipChecks: skip },
      );
      out.push(res.ms);
      await c.query("drop table public.o8_d");
      await c.query(
        "delete from supabase_migrations.schema_migrations where version=$1",
        [vv],
      );
    }
    return out;
  };
  log(
    `- durations secure apply WITHOUT check (ms): ${(await t(8, true)()).join(",")}`,
  );
  log(
    `- durations secure apply WITH 1-rule check (ms): ${(await t(8, false)()).join(",")}`,
  );
  // all-error block
  const all: number[] = [];
  for (let i = 0; i < 6; i++) {
    const vv = version();
    const res = await applyMigrationLikeCli(
      c,
      { version: vv, name: "o8_e", statements: secureFile("o8_e") },
      allError,
    );
    all.push(res.ms);
    await c.query("drop table if exists public.o8_e");
    await c.query(
      "delete from supabase_migrations.schema_migrations where version=$1",
      [vv],
    );
  }
  log(`- durations secure apply WITH 9-rule check (ms): ${all.join(",")}`);
  const read = buildAfterCommitRead(allError, {});
  const reads: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    for (const sql of read.statements) await c.query(sql);
    reads.push(Math.round(performance.now() - t0));
  }
  log(
    `- after-commit read, 9 rules, 4 statements, direct (ms): ${reads.join(",")}`,
  );
  await c.end();
}

function parseFindingsSafe(rows: unknown[]): string {
  return `${rows.length} rows${rows.length ? ` ${JSON.stringify((rows as { name: string }[]).slice(0, 5).map((r) => r.name))}` : ""}`;
}

async function leakProbe(label: string, open: () => Promise<pg.Client>) {
  // Fresh dirty-then-sample: run a blocked + a secure apply, then sample on N clients.
  const c = await open();
  const pid0 = (await c.query("select pg_backend_pid() p")).rows[0].p;
  await cellBlocked(c, `${label} (a) blocked`, "o8_pa");
  const pid1 = (await c.query("select pg_backend_pid() p")).rows[0].p;
  // secure apply with own SET LOCALs, then sample
  const v = version();
  const r = await applyMigrationLikeCli(
    c,
    {
      version: v,
      name: "o8_pb",
      statements: [
        "set local statement_timeout = '7s'",
        "set local search_path = public",
        "create table public.o8_pb (id int primary key)",
        "alter table public.o8_pb enable row level security",
      ],
    },
    rlsError,
  );
  log(
    `- ${label} (b) secure apply: outcome=${r.outcome}${r.outcome === "apply_error" ? ` ${r.error.message}` : ""} ms=${r.ms} history=${await historyRows(c, v)} table=${await exists(c, "public.o8_pb")}`,
  );
  // History row with the pipeline in tx mode: did the batch stay one transaction? (blocked => no history row, no table: covered by (a))
  const samples: Record<string, unknown>[] = [];
  const pids = new Set<number>();
  for (let i = 0; i < 15; i++) {
    const s = (await c.query(`${SETTINGS}, pg_backend_pid() as pid`)).rows[0];
    pids.add(s.pid);
    samples.push(s);
  }
  const other = await open();
  for (let i = 0; i < 10; i++) {
    const s = (await other.query(`${SETTINGS}, pg_backend_pid() as pid`))
      .rows[0];
    pids.add(s.pid);
    samples.push(s);
  }
  const distinct = [
    ...new Set(samples.map((s) => JSON.stringify({ ...s, pid: undefined }))),
  ];
  log(
    `- ${label} pid before/after apply: ${pid0}/${pid1}; distinct backend pids seen: ${pids.size}; distinct settings tuples in 25 follow-up queries: ${distinct.join(" | ")}`,
  );
  const leaked = samples.some(
    (s) =>
      s.st === "7s" ||
      s.sp === "public" ||
      (s.pgrst !== null &&
        s.pgrst !== "" &&
        s.pgrst !== undefined &&
        s.pgrst !== "public") ||
      s.sbc === "120000ms",
  );
  log(
    `- ${label} leak into later queries (7s / search_path=public / pgrst value): **${leaked ? "LEAK" : "none"}**`,
  );
  await other.end();
  await c.query("drop table if exists public.o8_pb").catch(() => {});
  await c
    .query(
      "delete from supabase_migrations.schema_migrations where version=$1",
      [v],
    )
    .catch(() => {});
  await c.end();
}

async function runPooler() {
  log("\n## Cell 2: Supavisor\n");
  log("### transaction mode (6543)");
  try {
    await leakProbe("tx", poolerTx);
  } catch (e) {
    log(`- tx probe error: ${(e as Error).message}`);
  }
  log("### session mode (5432)");
  try {
    const c = await poolerSession();
    await cellBlocked(c, "session (a) blocked", "o8_sa");
    await c.end();
  } catch (e) {
    log(`- session probe error: ${(e as Error).message}`);
  }
}

async function mgmtQuery(query: string) {
  const t = performance.now();
  const res = await fetch(`${API}/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  return {
    status: res.status,
    ms: Math.round(performance.now() - t),
    text,
    bytes: Buffer.byteLength(text),
  };
}

async function runMgmt() {
  log("\n## Cell 4: Management API /database/query\n");
  const hist = `create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key); alter table supabase_migrations.schema_migrations add column if not exists statements text[]; alter table supabase_migrations.schema_migrations add column if not exists name text;`;
  const h = await mgmtQuery(hist);
  log(`- history DDL: HTTP ${h.status} ${h.ms}ms ${h.text.slice(0, 200)}`);
  const block = buildCheckBlock(rlsError, {});
  const blocked = `begin;\n${blockedFile("o8_ma").join(";\n")};\n${block}insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261021900001','o8_ma',array['x']);\ncommit;`;
  const r = await mgmtQuery(blocked);
  log(
    `- 4a blocked via begin;file;check;insert;commit: HTTP ${r.status} ${r.ms}ms body_bytes=${r.bytes}\n  body: \`${r.text.slice(0, 900).replaceAll("`", "'")}\``,
  );
  const probe = await mgmtQuery(
    "select to_regclass('public.o8_ma') as t, (select count(*) from supabase_migrations.schema_migrations where version='20261021900001') as h",
  );
  log(`- 4a after: ${probe.text}`);
  // Leave open tx? ensure clean state
  await mgmtQuery("rollback").catch(() => {});
  const ok = `begin;\n${secureFile("o8_mb").join(";\n")};\n${block}insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261021900002','o8_mb',array['x']);\ncommit;`;
  const r2 = await mgmtQuery(ok);
  log(
    `- 4b secure: HTTP ${r2.status} ${r2.ms}ms body=${r2.text.slice(0, 300)}`,
  );
  const probe2 = await mgmtQuery(
    "select to_regclass('public.o8_mb') as t, (select count(*) from supabase_migrations.schema_migrations where version='20261021900002') as h",
  );
  log(`- 4b after: ${probe2.text}`);
  // timeout via API
  const to = buildCheckBlock(rlsError, { timeoutMs: 1 });
  const r3 = await mgmtQuery(
    `begin;\n${blockedFile("o8_mc").join(";\n")};\n${to}commit;`,
  );
  log(
    `- 4c timeout (1ms): HTTP ${r3.status} ${r3.ms}ms body=${r3.text.slice(0, 500)}`,
  );
  // NOTICE
  const n = await mgmtQuery(
    "do $$ begin raise notice 'o8-notice'; raise warning 'o8-warning'; end $$; select 1 as one",
  );
  log(
    `- NOTICE/WARNING via API: HTTP ${n.status} body=${n.text.slice(0, 300)} (notice text present: ${n.text.includes("o8-notice")})`,
  );
  // after-commit read
  await mgmtQuery(
    "drop table if exists public.o8_mb; delete from supabase_migrations.schema_migrations where version in ('20261021900001','20261021900002')",
  );
  const read = buildAfterCommitRead(allError, {});
  const rr = await mgmtQuery(read.sql);
  log(
    `- after-commit read as one string (begin;set_config;select;rollback): HTTP ${rr.status} ${rr.ms}ms bytes=${rr.bytes} body=${rr.text.slice(0, 200)}`,
  );
  const noRollback = read.statements.slice(0, 3).join(";\n");
  const rr2 = await mgmtQuery(noRollback);
  log(
    `- same without trailing rollback: HTTP ${rr2.status} ${rr2.ms}ms bytes=${rr2.bytes} body=${rr2.text.slice(0, 200)}`,
  );
  const tail = await mgmtQuery(
    `select pg_catalog.current_setting('pgrst.db_schemas', true) as pgrst, pg_catalog.current_setting('search_path') as sp, txid_current_if_assigned() as tx`,
  );
  log(`- follow-up API query settings: ${tail.text}`);
  // with a populated finding so payload is non-empty
  await mgmtQuery(
    "create table public.o8_mf (id int primary key); grant select on public.o8_mf to anon;",
  );
  const rr3 = await mgmtQuery(read.statements.slice(0, 3).join(";\n"));
  log(
    `- read without rollback, 1 finding present: HTTP ${rr3.status} ${rr3.ms}ms bytes=${rr3.bytes} body=${rr3.text.slice(0, 400)}`,
  );
  await mgmtQuery("drop table public.o8_mf");
}

async function runLogs() {
  log("\n## Cell 3b: Management API logs\n");
  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = new Date().toISOString();
  const sql = `select timestamp, event_message, metadata from postgres_logs where event_message like '%security check%' or event_message like '%rls_disabled_in_public%' or event_message like '%sbc.statement_timeout%' order by timestamp desc limit 20`;
  const url = `${API}/v1/projects/${REF}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}&iso_timestamp_start=${encodeURIComponent(start)}&iso_timestamp_end=${encodeURIComponent(end)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  log(`- logs HTTP ${res.status} bytes=${Buffer.byteLength(text)}`);
  try {
    const j = JSON.parse(text) as {
      result?: { event_message: string }[];
      error?: unknown;
    };
    const rows = j.result ?? [];
    log(
      `- rows matched: ${rows.length}; max event_message bytes: ${Math.max(0, ...rows.map((r) => Buffer.byteLength(r.event_message ?? "")))}`,
    );
    for (const r of rows.slice(0, 5))
      log(`  - ${(r.event_message ?? "").slice(0, 200).replaceAll("\n", " ")}`);
    if (!rows.length) log(`  raw: ${text.slice(0, 300)}`);
  } catch {
    log(`  raw: ${text.slice(0, 300)}`);
  }
}

async function runExtra() {
  log("\n## Cell 1 extras: timeout threshold and interleaved durations\n");
  const c = await direct();
  for (const ms of [5, 20, 50, 100, 200]) {
    const v = version();
    const table = `o8_t${ms}`;
    const r = await applyMigrationLikeCli(
      c,
      { version: v, name: table, statements: blockedFile(table) },
      rlsError,
      { timeoutMs: ms },
    );
    log(
      `- timeoutMs=${ms}: outcome=${r.outcome}${r.outcome === "apply_error" ? ` sqlstate=${r.error.code}` : ""} ms=${r.ms}`,
    );
  }
  const a: number[] = [];
  const b: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < 10; i++) {
    for (const [skip, out] of [
      [true, a],
      [false, b],
    ] as const) {
      const vv = version();
      const res = await applyMigrationLikeCli(
        c,
        { version: vv, name: "o8_i", statements: secureFile("o8_i") },
        rlsError,
        { skipChecks: skip },
      );
      out.push(res.ms);
      await c.query("drop table o8_i".replace("o8_i", "public.o8_i"));
      await c.query(
        "delete from supabase_migrations.schema_migrations where version=$1",
        [vv],
      );
    }
  }
  log(`- interleaved no-check (ms): ${a.join(",")}`);
  log(`- interleaved 1-rule check (ms): ${b.join(",")}`);
  // server-side check time: run the DO inside a rolled-back tx with explain-free wall clock
  const stmts = buildCheckStatements(allError, {});
  for (let i = 0; i < 4; i++) {
    await c.query("begin");
    const t0 = (await c.query("select clock_timestamp() t")).rows[0].t as Date;
    for (const sql of stmts) await c.query(sql);
    const t1 = (await c.query("select clock_timestamp() t")).rows[0].t as Date;
    await c.query("rollback");
    s.push(t1.getTime() - t0.getTime());
  }
  log(
    `- 9-rule check block, 4 statements sequential in tx incl. RTTs (ms): ${s.join(",")} (RTT ~90 each, 6 round trips with clock reads)`,
  );
  await c.end();
}

const which = process.argv[2] ?? "all";
if (which === "direct" || which === "all") await runDirect();
if (which === "extra") await runExtra();
if (which === "pooler" || which === "all") await runPooler();
if (which === "mgmt" || which === "all") await runMgmt();
if (which === "logs" || which === "all") await runLogs();
