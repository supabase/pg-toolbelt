/**
 * Point 5 probe: can the after-commit warn read ride in the same Management API
 * call as the migration (`begin; file; check; history; commit; <read>`)?
 *
 * Starts supabase/postgres plus supabase/postgres-meta (as supabase_admin, the
 * way the platform connects), POSTs strings to pg-meta `/query` the way
 * `applyMigration` does (apps/mgmt-api project-database-migrations.ts, with
 * `skipStatementTimeout`: only `queryTimeoutSecs=185`), and appends one section
 * per cell to REPORT.md.
 *
 *   DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock bun scripts/point5-probe.ts
 *   POINT5_PG=public.ecr.aws/supabase/postgres:17.11.0.005
 *   POINT5_META=public.ecr.aws/supabase/postgres-meta:v0.100.0
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import pg from "pg";
import {
  buildAfterCommitRead,
  buildCheckBlock,
  parseFindings,
  resolvePolicy,
} from "../src/index.ts";
import { SPLINTER_QUERY } from "../src/vendor/splinter.ts";

const PG_IMAGE =
  process.env["POINT5_PG"] ?? "public.ecr.aws/supabase/postgres:17.11.0.005";
const META_IMAGE =
  process.env["POINT5_META"] ??
  "public.ecr.aws/supabase/postgres-meta:v0.100.0";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const id = Date.now().toString(36);
const dir = `${homedir()}/.cache/supabase-pg-checks-dogfood/point5-${stamp}`;
mkdirSync(dir, { recursive: true });

const log = (text: string) => {
  appendFileSync(`${dir}/REPORT.md`, `${text}\n`);
  console.log(text);
};
const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const net = `point5-net-${id}`;
const pgName = `point5-pg-${id}`;
const metaName = `point5-meta-${id}`;
const cleanup = () => {
  for (const args of [
    ["rm", "-f", metaName, pgName],
    ["network", "rm", net],
  ]) {
    try {
      docker(...args);
    } catch {
      // already gone
    }
  }
};

const admin = () => {
  const addr = docker("port", pgName, "5432/tcp").split("\n")[0] as string;
  const [host, port] = addr.split(":") as [string, string];
  const client = new pg.Client({
    host,
    port: Number(port),
    user: "supabase_admin",
    password: "postgres",
    database: "postgres",
  });
  client.on("error", () => {});
  return client;
};

async function start() {
  docker("network", "create", net);
  docker(
    "run",
    "-d",
    "--name",
    pgName,
    "--network",
    net,
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,noexec,nosuid,size=1024m",
    PG_IMAGE,
  );
  for (let i = 0; i < 120; i++) {
    const health = docker("inspect", "-f", "{{.State.Health.Status}}", pgName);
    if (health === "healthy") break;
    await sleep(1000);
  }
  docker(
    "run",
    "-d",
    "--name",
    metaName,
    "--network",
    net,
    "-p",
    "127.0.0.1::8080",
    "-e",
    `PG_META_DB_URL=${pgUrl()}`,
    META_IMAGE,
  );
  const addr = docker("port", metaName, "8080/tcp").split("\n")[0] as string;
  const url = `http://${addr}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return url;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("pg-meta did not come up");
}

// ---------------------------------------------------------------------------
// The platform's SQL, ported (applyAndTrackMigrations / upsertMigrationHistory).

const COLUMNS =
  "version, name, statements, created_by, idempotency_key, rollback";
const INIT_HISTORY = `begin;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
alter table supabase_migrations.schema_migrations add column if not exists created_by text;
alter table supabase_migrations.schema_migrations add column if not exists idempotency_key text unique;
alter table supabase_migrations.schema_migrations add column if not exists rollback text[];
commit;`;

interface ApplyOptions {
  readonly check?: string;
  /** Between the history insert and `commit`. */
  readonly beforeCommit?: string;
  /** After `commit`: the proposal. */
  readonly after?: string;
  readonly key?: string;
}

function applyAndTrack(query: string, options: ApplyOptions = {}) {
  const dollar = `$p5${Math.random().toString(36).slice(2, 12)}$`;
  const quote = (s?: string) => (s ? dollar + s + dollar : `''`);
  const history = `insert into supabase_migrations.schema_migrations as old
  (${COLUMNS})
values (
  to_char(current_timestamp, 'YYYYMMDDHH24MISS'),
  ${quote("probe")},
  array[${quote(query)}],
  ${quote("probe@example.com")},
  ${options.key ? quote(options.key) : "null"},
  null
)
on conflict (idempotency_key) do update set
  version = EXCLUDED.version,
  name = coalesce(EXCLUDED.name, old.name),
  statements = EXCLUDED.statements,
  rollback = EXCLUDED.rollback,
  created_by = EXCLUDED.created_by;`;
  return `begin;

-- apply sql from post body
${query};

${options.check ?? ""}
${history}
${options.beforeCommit ?? ""}
commit;${options.after ? `\n${options.after}` : ""}`;
}

// ---------------------------------------------------------------------------

interface ApiResult {
  readonly status: number;
  readonly body: string;
  readonly ms: number;
}

let META = "";
const pgUrl = () =>
  `postgres://supabase_admin:postgres@${pgName}:5432/postgres?sslmode=disable`;

async function api(
  sql: string,
  params: Record<string, string> = { queryTimeoutSecs: "185" },
): Promise<ApiResult> {
  const qs = new URLSearchParams(params).toString();
  const t0 = performance.now();
  const response = await fetch(`${META}/query?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await response.text();
  return {
    status: response.status,
    body,
    ms: Math.round(performance.now() - t0),
  };
}

const elide = (sql: string) =>
  sql.replaceAll(SPLINTER_QUERY, "/* splinter query, 75 KB */");
const clip = (text: string, max = 900) =>
  text.length > max ? `${text.slice(0, max)} ...(${text.length} chars)` : text;
const rowsOf = (body: string): Record<string, unknown>[] | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
};
const summary = (r: ApiResult) => {
  const rows = rowsOf(r.body);
  const shape = rows
    ? `${rows.length} row(s), columns [${[...new Set(rows.flatMap((x) => Object.keys(x)))].slice(0, 8).join(", ")}], names [${rows
        .map((x) => x["name"])
        .filter((n): n is string => typeof n === "string")
        .join(", ")}]`
    : "not a row array";
  return `HTTP ${r.status} in ${r.ms} ms; ${shape}\n\n\`\`\`\n${clip(r.body)}\n\`\`\``;
};
const sqlBlock = (sql: string) =>
  `\`\`\`sql\n${clip(elide(sql), 2500)}\n\`\`\``;

let db: pg.Client;
async function reset() {
  await db.query(`drop table if exists public.t1, public.canary cascade;
    drop function if exists public.f();
    truncate supabase_migrations.schema_migrations`);
}
async function state() {
  const { rows } = await db.query(`select
    to_regclass('public.t1') is not null as t1,
    to_regprocedure('public.f()') is not null as f,
    to_regclass('public.canary') is not null as canary,
    (select count(*) from supabase_migrations.schema_migrations)::int as history`);
  return rows[0] as {
    t1: boolean;
    f: boolean;
    canary: boolean;
    history: number;
  };
}
const fmtState = (s: Awaited<ReturnType<typeof state>>) =>
  `t1 ${s.t1 ? "EXISTS" : "absent"}, f() ${s.f ? "EXISTS" : "absent"}, canary ${s.canary ? "EXISTS" : "absent"}, history rows ${s.history}`;

const FILE_WITH_FINDINGS = `create table public.t1 (id int primary key);
create function public.f() returns int language sql as 'select 1'`;
const FILE_RLS_ON = `create table public.t1 (id int primary key);
alter table public.t1 enable row level security;
create function public.f() returns int language sql as 'select 1'`;

const warnPolicy = resolvePolicy({});
const errorPolicy = resolvePolicy({ rls_disabled_in_public: "error" });
const exposed = { exposedSchemas: ["public"] };
const readOf = (policy = warnPolicy) => buildAfterCommitRead(policy, exposed);

/** Lint rows as one jsonb value, for the exception-wrapped reads. */
function lintJson(policy = warnPolicy) {
  const read = readOf(policy);
  const lint = read.statements[read.resultIndex] as string;
  return `select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::pg_catalog.jsonb) from (${lint}) r`;
}

/** The read as a DO that cannot raise: any error lands in sbc.findings. */
function safeDo(policy = warnPolicy, restore = false) {
  return `do $p5$
declare
  prev_search_path pg_catalog.text := pg_catalog.current_setting('search_path');
  prev_db_schemas pg_catalog.text := pg_catalog.current_setting('pgrst.db_schemas', true);
  f pg_catalog.jsonb;
begin
  begin
    perform pg_catalog.set_config('search_path', '', true);
    perform pg_catalog.set_config('pgrst.db_schemas', 'public', true);
    execute $p5q$
${lintJson(policy)}
$p5q$ into f;
    perform pg_catalog.set_config('sbc.findings', f::pg_catalog.text, true);
    ${restore ? "perform pg_catalog.set_config('search_path', prev_search_path, true); perform pg_catalog.set_config('pgrst.db_schemas', coalesce(prev_db_schemas, ''), true);" : ""}
  exception when query_canceled or others then
    perform pg_catalog.set_config('sbc.findings', pg_catalog.jsonb_build_object('read_error', sqlstate, 'message', sqlerrm)::pg_catalog.text, true);
  end;
end
$p5$`;
}

/** Non-raising read run after commit, in its own transaction. */
const safeAfter = (timeoutMs?: number, policy = warnPolicy) =>
  `begin;
${timeoutMs ? `set local statement_timeout = '${timeoutMs}ms';` : ""}
${safeDo(policy)};
select pg_catalog.current_setting('sbc.findings', true) as sbc_findings;
rollback;`;

/** The same read inside the migration transaction, before commit. */
const preCommitRead = (timeoutMs?: number, policy = warnPolicy) => ({
  beforeCommit: `select pg_catalog.set_config('sbc.statement_timeout', pg_catalog.current_setting('statement_timeout'), true);
${timeoutMs ? `set local statement_timeout = '${timeoutMs}ms';` : ""}
${safeDo(policy, true)};
select pg_catalog.set_config('statement_timeout', pg_catalog.current_setting('sbc.statement_timeout'), true);
select pg_catalog.current_setting('sbc.findings', true) as sbc_findings;`,
});

const verdicts: string[] = [];

async function cell1() {
  log(`\n## Cell 1: happy path\n`);
  const init = await api(INIT_HISTORY);
  if (init.status !== 200)
    throw new Error(`history init failed: ${init.status} ${init.body}`);

  await reset();
  const baseline = applyAndTrack(FILE_WITH_FINDINGS);
  const b = await api(baseline);
  log(
    `### 1a. Today's string, no read\n\n${sqlBlock(baseline)}\n\n${summary(b)}\n\nDB: ${fmtState(await state())}`,
  );

  await reset();
  const warnSql = applyAndTrack(FILE_WITH_FINDINGS, {
    check: buildCheckBlock(warnPolicy, exposed),
    after: readOf().sql,
  });
  const w = await api(warnSql);
  const wRows = rowsOf(w.body) ?? [];
  const parsed = parseFindings(wRows, warnPolicy);
  log(
    `### 1b. All rules warn (no DO), read appended after commit\n\n${sqlBlock(warnSql)}\n\n${summary(w)}\n\nparseFindings: ${parsed.map((f) => `${f.rule}:${f.name}`).join(", ") || "none"}\n\nDB: ${fmtState(await state())}\n\nLatency delta vs 1a: ${w.ms - b.ms} ms (local, no RTT).`,
  );

  await reset();
  const errSql = applyAndTrack(FILE_RLS_ON, {
    check: buildCheckBlock(errorPolicy, exposed),
    after: readOf(errorPolicy).sql,
  });
  const e = await api(errSql);
  const eParsed = parseFindings(rowsOf(e.body) ?? [], errorPolicy);
  log(
    `### 1c. rls_disabled_in_public at error (passes), warn rest, read after commit\n\n${sqlBlock(errSql)}\n\n${summary(e)}\n\nparseFindings: ${eParsed.map((f) => `${f.rule}:${f.name}`).join(", ") || "none"}\n\nDB: ${fmtState(await state())}`,
  );

  await reset();
  const clean = applyAndTrack("create schema other_s", {
    after: readOf().sql,
  });
  const c = await api(clean);
  log(
    `### 1d. Zero findings\n\n${summary(c)}\n\nparseFindings: ${parseFindings(rowsOf(c.body) ?? [], warnPolicy).length} finding(s)`,
  );
  await db.query("drop schema other_s");
  verdicts.push(
    `1: happy path ${w.status === 200 && parsed.length >= 2 ? "PASS" : "CHECK"}: findings come back as rows, migration committed`,
  );
}

async function cell2() {
  log(`\n## Cell 2: the read fails after commit\n`);
  const cases: [string, string][] = [
    [
      "2a. broken read statement",
      `begin;\nselect * from public.no_such_table_after_commit;\nrollback;`,
    ],
    [
      "2b. 1 ms statement_timeout on the plain read",
      `begin;\nset local statement_timeout = '1ms';\n${readOf().statements.slice(1).join(";\n")};`,
    ],
  ];
  for (const [label, after] of cases) {
    await reset();
    const sql = applyAndTrack(FILE_WITH_FINDINGS, { after });
    const r = await api(sql);
    log(
      `### ${label}\n\n${sqlBlock(sql.slice(sql.indexOf("commit;")))}\n\n${summary(r)}\n\nDB: ${fmtState(await state())}`,
    );
  }

  log(`### 2c. Retry after the false failure\n`);
  await reset();
  const first = applyAndTrack("create table if not exists public.t1 (id int)", {
    after: `select * from public.no_such_table_after_commit;`,
  });
  const r1 = await api(first);
  await sleep(1100);
  const r2 = await api(first);
  const rows = await db.query(
    "select version, name, idempotency_key from supabase_migrations.schema_migrations order by version",
  );
  log(
    `Idempotent DDL (\`create table if not exists\`), no Idempotency-Key, sent twice 1.1 s apart.\n\n1st: HTTP ${r1.status}; 2nd: HTTP ${r2.status}\n\nHistory rows after retry: ${rows.rowCount} (${rows.rows.map((x) => x.version).join(", ")})`,
  );

  await reset();
  const keyed = applyAndTrack("create table if not exists public.t1 (id int)", {
    key: "k-1",
    after: `select * from public.no_such_table_after_commit;`,
  });
  await api(keyed);
  await sleep(1100);
  await api(keyed);
  const keyedRows = await db.query(
    "select version, idempotency_key from supabase_migrations.schema_migrations order by version",
  );
  log(
    `Same with an Idempotency-Key: ${keyedRows.rowCount} row(s) (${keyedRows.rows.map((x) => `${x.version}/${x.idempotency_key}`).join(", ")}); the upsert rewrites \`version\`, the DDL ran twice.`,
  );

  await reset();
  const plain = applyAndTrack("create table public.t1 (id int)", {
    after: `select * from public.no_such_table_after_commit;`,
  });
  await api(plain);
  const retry = await api(plain);
  log(
    `Non-idempotent DDL (\`create table\`) retried: HTTP ${retry.status}: ${clip(retry.body, 300)}\n\nDB: ${fmtState(await state())} (the client's retry fails with "already exists" and hides that the first attempt committed).`,
  );
  verdicts.push(
    "2: a failing read after commit returns an error response for a committed migration (UNSAFE for a plain read)",
  );
}

type Outcome = Map<string, number>;
const bump = (m: Outcome, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

async function classify(
  r: ApiResult,
  s: Awaited<ReturnType<typeof state>>,
): Promise<string> {
  const committed = s.history > 0 ? "committed" : "rolled back";
  if (r.status === 200) {
    const rows = rowsOf(r.body) ?? [];
    const cell = rows.find((x) => "sbc_findings" in x)?.["sbc_findings"];
    if (typeof cell !== "string") return `200 no sbc row, ${committed}`;
    return `200 ${cell.includes("read_error") ? "read_error captured" : "findings"}, ${committed}`;
  }
  const code = /\b(57014|[0-9A-Z]{5}):/.exec(r.body)?.[1] ?? clip(r.body, 60);
  return `HTTP ${r.status} (${code}), ${committed}`;
}

async function cell3() {
  log(
    `\n## Cell 3: the read cannot raise (DO with exception handler, result in sbc.findings)\n`,
  );
  await reset();
  const happy = applyAndTrack(FILE_WITH_FINDINGS, { after: safeAfter() });
  const h = await api(happy);
  const hRows = rowsOf(h.body) ?? [];
  const cellValue = hRows[0]?.["sbc_findings"];
  const inner =
    typeof cellValue === "string" ? (JSON.parse(cellValue) as unknown[]) : [];
  log(
    `### 3a. Happy path, after commit\n\n${sqlBlock(happy.slice(happy.indexOf("commit;")))}\n\n${summary(h)}\n\nsbc_findings decodes to ${inner.length} lint row(s); parseFindings: ${parseFindings(
      inner,
      warnPolicy,
    )
      .map((f) => `${f.rule}:${f.name}`)
      .join(", ")}`,
  );

  const trials = 20;
  for (const [title, build] of [
    [
      "3b. After commit, `set local statement_timeout` on the read",
      (ms: number) =>
        applyAndTrack(FILE_WITH_FINDINGS, { after: safeAfter(ms) }),
    ],
    [
      "3c. Before commit (inside the migration transaction), same wrapper",
      (ms: number) => applyAndTrack(FILE_WITH_FINDINGS, preCommitRead(ms)),
    ],
  ] as const) {
    log(
      `### ${title}\n\n${trials} trials per timeout; outcome distribution (HTTP result and whether the migration committed):\n`,
    );
    for (const ms of [1, 3, 10, 50]) {
      const dist: Outcome = new Map();
      for (let i = 0; i < trials; i++) {
        await reset();
        const r = await api(build(ms));
        bump(dist, await classify(r, await state()));
      }
      log(`- ${ms} ms: ${[...dist].map(([k, v]) => `${v}x ${k}`).join("; ")}`);
    }
  }
  await reset();
  const pre = applyAndTrack(FILE_WITH_FINDINGS, preCommitRead());
  const p = await api(pre);
  log(
    `### 3d. Before commit, no local timeout, happy path\n\n${summary(p)}\n\nDB: ${fmtState(await state())}\n\nThe \`commit\` returns no rows, so the last row-returning statement is the \`select current_setting(...)\` before it.`,
  );
  await reset();
  const broken = applyAndTrack(FILE_WITH_FINDINGS, {
    beforeCommit: "select * from public.no_such_table_in_read;",
  });
  const bk = await api(broken);
  log(
    `### 3e. Before commit, a read step fails in a way the handler cannot catch (stand-in: bad statement)\n\n${summary(bk)}\n\nDB: ${fmtState(await state())}\n\nThe error rolls the migration back, so the response and the database agree. Compare 2a.`,
  );
  const s = await db.query(
    `select current_setting('search_path') sp, current_setting('statement_timeout') st`,
  );
  log(
    `(Restore check: a fresh admin session reads ${JSON.stringify(s.rows[0])}.)`,
  );
}

async function cell4() {
  log(`\n## Cell 4: SB001 block with the read appended\n`);
  for (const [label, after] of [
    ["4a. read appended", readOf(errorPolicy).sql],
    [
      "4b. canary DDL appended after commit (proves nothing after the error runs)",
      "create table public.canary (id int);",
    ],
  ] as const) {
    await reset();
    const sql = applyAndTrack("create table public.t1 (id int primary key)", {
      check: buildCheckBlock(errorPolicy, exposed),
      after,
    });
    const r = await api(sql);
    log(`### ${label}\n\n${summary(r)}\n\nDB: ${fmtState(await state())}`);
  }
  await reset();
  const bad = applyAndTrack("create table public.t1 (id int primary key", {
    after: "create table public.canary (id int);",
  });
  const r = await api(bad);
  log(
    `### 4c. Syntax error in the file\n\n${summary(r)}\n\nDB: ${fmtState(await state())}`,
  );
  verdicts.push(
    "4: an SB001 / file error stops the string at the failing statement; the appended read and canary never run",
  );
}

async function cell5() {
  log(`\n## Cell 5: rows shape\n`);
  await reset();
  const src = `create table public.t1 (id int primary key);
create function public.f() returns int language sql as 'select 1';
select 42 as answer`;
  const variants: [string, string][] = [
    [
      "5a. file ends with `select 42`, plain read after commit (read ends with `rollback`)",
      readOf().sql,
    ],
    [
      "5b. no read appended (every rule off: `buildAfterCommitRead` returns an empty script), so today's behavior",
      "",
    ],
    [
      "5c. read then a trailing `select 'tail' as tail`",
      `${readOf().sql}\nselect 'tail' as tail;`,
    ],
  ];
  for (const [label, after] of variants) {
    await reset();
    const sql = applyAndTrack(src, { after });
    const r = await api(sql);
    log(`### ${label}\n\n${summary(r)}`);
  }
  await reset();
  const bare = applyAndTrack("select 42 as answer", {
    after: `begin;\n${readOf().statements.slice(2).join(";\n")};`,
  });
  const bareR = await api(bare);
  log(
    `### 5e. Read WITHOUT its leading set_config select, zero findings\n\n${summary(bareR)}\n\nWith no finding and no sentinel row, the file's own rows come back as if they were the answer. Keep a row that is always returned (the set_config select, or the sbc_findings select).`,
  );
  await reset();
  const noFinding = applyAndTrack("select 42 as answer", {
    after: readOf().sql,
  });
  const nf = await api(noFinding);
  log(
    `### 5d. File returns rows, read finds nothing\n\n${summary(nf)}\n\nThe \`set_config\` row of the read is last, so the file's rows never leak into the findings; \`parseFindings\` ignores it.`,
  );
  verdicts.push(
    "5: pg-meta returns the LAST statement WITH rows (not the last statement), so a trailing rollback does not hide findings",
  );
}

async function cell6() {
  log(`\n## Cell 6: session leaks across calls\n`);
  await reset();
  const ids = async () => {
    const r = await api(
      `select pg_backend_pid() as pid, current_setting('statement_timeout') as statement_timeout, current_setting('search_path') as search_path, current_setting('pgrst.db_schemas', true) as db_schemas, current_setting('sbc.findings', true) as findings, current_setting('sbc.statement_timeout', true) as sbc_st, current_setting('idle_session_timeout') as idle`,
    );
    return r;
  };
  const before = await ids();
  const mig = await api(
    applyAndTrack(FILE_RLS_ON, {
      check: buildCheckBlock(errorPolicy, exposed),
      after: readOf(errorPolicy).sql,
    }),
  );
  const mid = await ids();
  await reset();
  const mig2 = await api(applyAndTrack("select 1", { after: safeAfter() }));
  const after = await ids();
  log(
    `Next \`/query\` call before / after the migration string (check + plain read), and after a second one (exception-wrapped read):\n\n- before: ${clip(before.body, 300)}\n- after plain read: ${clip(mid.body, 300)}\n- after wrapped read: ${clip(after.body, 300)}\n\n(statuses ${mig.status}, ${mig2.status}). pg-meta builds a new \`pg.Pool\` per request and calls \`pgMeta.end()\`, so each call gets a new backend (pid differs above).`,
  );

  const client = admin();
  await client.connect();
  await client.query(readOf().sql);
  const same = await client.query(
    `select current_setting('search_path') sp, current_setting('pgrst.db_schemas', true) dbs, current_setting('sbc.findings', true) f`,
  );
  await client.end();
  log(
    `Contrast, one reused backend (what a pooler does): after the plain read on the same session: ${JSON.stringify(same.rows[0])}. \`pgrst.db_schemas\` stays \`''\` (known pitfall 2); search_path is back to the default.`,
  );
}

async function cell7() {
  log(`\n## Cell 7: other risks\n`);
  await reset();
  const timeout = applyAndTrack(
    "select pg_sleep(2); create table public.t1 (id int)",
    { after: readOf().sql },
  );
  const r = await api(timeout, { queryTimeoutSecs: "1" });
  const early = await state();
  await sleep(4000);
  const late = await state();
  log(
    `### 7a. pg-meta \`query_timeout\` (client side) shorter than the string\n\nqueryTimeoutSecs=1, migration sleeps 2 s: ${summary(r)}\n\nDB right after: ${fmtState(early)}\n\nDB 4 s later: ${fmtState(late)}\n\nThe API reports an error (HTTP 408 "Query read timeout") while the backend keeps running and commits. Platform passes \`queryTimeoutSecs=185\` with \`skipStatementTimeout\`, so no \`statement_timeout\` is set by pg-meta and nothing cancels the backend. This exists today; the read adds its own duration to the same budget.`,
  );

  try {
    await db.query("create extension if not exists pg_stat_statements");
  } catch {
    // preloaded or not permitted
  }
  try {
    const { rows } = await db.query(
      `select count(*)::int n, max(length(query))::int max_len from pg_stat_statements where query like '%rls_disabled_in_public%'`,
    );
    log(
      `### 7b. pg_stat_statements\n\nEntries containing the splinter query: ${JSON.stringify(rows[0])}. Each statement of a multi-statement string is a separate entry, so the 75 KB lint select appears once per distinct text (read and check differ), as with the check block alone.`,
    );
  } catch (error) {
    log(`### 7b. pg_stat_statements\n\nnot readable: ${String(error)}`);
  }
  const show = await db.query(
    `select current_setting('log_statement') ls, current_setting('statement_timeout') st`,
  );
  log(
    `### 7c. Limits\n\n- pg-meta Fastify \`bodyLimit\` default 3 MiB (\`PG_META_MAX_BODY_LIMIT_MB\`), \`src/server/constants.ts:57\`. The read adds about 75 KB (check block adds another 75 KB at \`error\`).\n- Server settings seen: ${JSON.stringify(show.rows[0])}.`,
  );
}

async function main() {
  META = await start();
  db = admin();
  await db.connect();
  const version = (await db.query("select version() v")).rows[0].v as string;
  log(
    `# Point 5 probe: after-commit read in the same API call\n\n- Postgres: ${PG_IMAGE} (${version.split(",")[0]})\n- pg-meta: ${META_IMAGE}, queried as supabase_admin with \`queryTimeoutSecs=185\` and no \`statementTimeoutSecs\` (the platform's \`skipStatementTimeout\` path)\n- Date: ${stamp}`,
  );
  try {
    await cell1();
    await cell2();
    await cell3();
    await cell4();
    await cell5();
    await cell6();
    await cell7();
  } finally {
    await db.end();
  }
  log(`\n## Summary\n\n${verdicts.map((v) => `- ${v}`).join("\n")}`);
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
try {
  await main();
} finally {
  cleanup();
}
