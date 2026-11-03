/**
 * Dogfood: replays real projects' migrations through a CLI-faithful executor in
 * three passes and reports what the security check would have done.
 *
 *   bun scripts/dogfood.ts [--pg 17|15] [--projects a,b] [--samples <dir>]
 *     [--cli <supabase/cli checkout>] [--concurrency 2] [--budget-min 25]
 *
 * Per project, in a scratch copy under ~/.cache/supabase-pg-checks-dogfood/<ts>/,
 * on three fresh supabase/postgres containers:
 *   (a) baseline, no check;  (b) every rule at warn + after-commit read per file;
 *   (c) every rule at error, stopping at the first blocked file like the CLI;
 *   (d) the four core rules (D8) at error, the rest at warn, same stop rule.
 * Each pass stops at its first failing file, like the CLI. Writes REPORT.md + report.json.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type pg from "pg";
import {
  type Finding,
  RULES,
  SPLINTER_VERSION,
  buildAfterCommitRead,
  buildCheckBlock,
  resolvePolicy,
} from "../src/index.ts";
import {
  type MigrationFile,
  applyMigrationLikeCli,
  hasTransactionControl,
  isPipelineIncompatible,
  readFindings,
} from "../tests/cli-executor.ts";
import {
  SUPABASE_IMAGES,
  startSupabasePostgres,
} from "../tests/supabase-postgres.ts";

const { values } = parseArgs({
  options: {
    pg: { type: "string", default: "17" },
    projects: { type: "string" },
    samples: {
      type: "string",
      default: join(
        homedir(),
        "Documents/Programming/Supa/supabase-config-real-world-samples",
      ),
    },
    cli: {
      type: "string",
      default: join(homedir(), "Documents/Programming/Supa/cli"),
    },
    concurrency: { type: "string", default: "2" },
    "budget-min": { type: "string", default: "25" },
    out: { type: "string" },
    // SQL replayed as supabase_admin before the migrations: the bare→`supabase start`
    // delta (auth/storage/realtime tables, stack default privileges). `none` = bare image.
    baseline: { type: "string" },
  },
});
const major = values.pg as keyof typeof SUPABASE_IMAGES;
const image = SUPABASE_IMAGES[major];
if (image === undefined)
  throw new Error(
    `--pg must be one of ${Object.keys(SUPABASE_IMAGES).join(", ")}`,
  );
const deadline = Date.now() + Number(values["budget-min"]) * 60_000;
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outDir =
  values.out ??
  join(homedir(), ".cache/supabase-pg-checks-dogfood", `${stamp}-pg${major}`);
mkdirSync(outDir, { recursive: true });
const pgDeltaBaseline = join(
  import.meta.dir,
  "../../pg-delta/tests/fixtures/supabase-base-init",
  `${major}.sql`,
);
const baselinePath =
  values.baseline === "none"
    ? undefined
    : (values.baseline ??
      (existsSync(pgDeltaBaseline) ? pgDeltaBaseline : undefined));
const baselineSql =
  baselinePath === undefined ? undefined : readFileSync(baselinePath, "utf8");

// The CLI's own splitter (self-contained module), so statements match `supabase db push`.
const { splitAndTrim } = (await import(
  join(values.cli, "apps/cli/src/command-internal/sql-split.ts")
)) as { splitAndTrim: (sql: string) => string[] };

const NO_TRANSACTION_DIRECTIVE = "-- pg-delta: transaction=false";
const MIGRATE_FILE_PATTERN = /^([0-9]+)_(.*)\.sql$/u;

function loadMigrations(supabaseDir: string): MigrationFile[] {
  const dir = join(supabaseDir, "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((file) => {
      const match = MIGRATE_FILE_PATTERN.exec(file);
      return match
        ? [{ file, version: match[1] ?? "", name: match[2] ?? "" }]
        : [];
    })
    .sort((x, y) =>
      BigInt(x.version) < BigInt(y.version)
        ? -1
        : BigInt(x.version) > BigInt(y.version)
          ? 1
          : 0,
    )
    .map(({ file, version, name }) => {
      const content = readFileSync(join(dir, file), "utf8");
      const withoutBom =
        content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
      const firstLine = (withoutBom.split("\n")[0] ?? "").replace(/\r$/, "");
      const none = firstLine === NO_TRANSACTION_DIRECTIVE;
      return {
        version,
        name,
        statements: splitAndTrim(none ? withoutBom : content),
        transactionMode: none ? ("none" as const) : ("transactional" as const),
      };
    });
}

function exposedSchemas(supabaseDir: string): string[] {
  const path = join(supabaseDir, "config.toml");
  if (!existsSync(path)) return ["public"];
  const config = Bun.TOML.parse(readFileSync(path, "utf8")) as {
    api?: { schemas?: unknown };
  };
  const schemas = config.api?.schemas;
  return Array.isArray(schemas) && schemas.length > 0
    ? (schemas as string[])
    : ["public"];
}

const CATALOG_FINGERPRINT = `
with objs as (
  select 'class:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text as o
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
  union all
  select 'proc:' || n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')'
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
  union all
  select 'policy:' || schemaname || '.' || tablename || '.' || policyname from pg_catalog.pg_policies
)
select pg_catalog.md5(pg_catalog.string_agg(o, '|' order by o)) as md5,
  count(*) filter (where o like 'class:%') as classes,
  count(*) filter (where o like 'proc:%') as procs,
  count(*) filter (where o like 'policy:%') as policies
from objs`;

type Pass = "a" | "b" | "c" | "d";
const PASSES = ["a", "b", "c", "d"] as const;
const CORE_RULES = [
  "rls_disabled_in_public",
  "rls_enabled_no_policy",
  "policy_exists_rls_disabled",
  "security_definer_view",
];

interface FileRecord {
  readonly file: string;
  readonly split:
    | false
    | "transaction_control"
    | "pipeline_incompatible"
    | "directive";
  outcome: Partial<Record<Pass, string>>;
  ms: Partial<Record<Pass, number>>;
  error?: Partial<Record<Pass, string>>;
  readMs?: number;
  /** Findings first seen after this file (pass b), as `rule schema.name`. */
  introduced?: string[];
  /** Error findings that blocked the file (or that a split file applied with), as `rule schema.name`. */
  blockedBy: Partial<Record<Pass, string[]>>;
}

interface PassSummary {
  applied: number;
  /** Bytes the check adds to each transactional file (the file itself excluded). */
  checkBytes?: number;
  /** Bytes of the after-commit read. */
  readBytes?: number;
  stoppedAt?: string;
  stopReason?: string;
  historyRows?: number;
  fingerprint?: {
    md5: string;
    classes: number;
    procs: number;
    policies: number;
  };
  finalFindings?: Record<string, number>;
}

interface ProjectRecord {
  readonly project: string;
  readonly exposedSchemas: string[];
  readonly files: FileRecord[];
  passes: Partial<Record<Pass, PassSummary>>;
  anomalies: string[];
  envError?: string;
  wallMs?: number;
}

const splitReason = (file: MigrationFile): FileRecord["split"] =>
  file.transactionMode === "none"
    ? "directive"
    : file.statements.some(hasTransactionControl)
      ? "transaction_control"
      : file.statements.some(isPipelineIncompatible)
        ? "pipeline_incompatible"
        : false;

const findingKey = (f: Finding) =>
  `${f.rule} ${f.schema}.${f.name} ${f.detail}`;

/** Unique `rule schema.name` entries. */
const objectsOf = (findings: Finding[]) => [
  ...new Set(findings.map((f) => `${f.rule} ${f.schema}.${f.name}`)),
];
const ruleOf = (entry: string) => entry.split(" ")[0] ?? entry;

const countByRule = (findings: Finding[]) =>
  Object.fromEntries(
    RULES.map((rule) => [
      rule,
      findings.filter((f) => f.rule === rule).length,
    ]).filter(([, n]) => (n as number) > 0),
  ) as Record<string, number>;

async function runPass(
  pass: Pass,
  project: ProjectRecord,
  migrations: MigrationFile[],
): Promise<void> {
  const db = await startSupabasePostgres(image);
  let client: pg.Client | undefined;
  const summary: PassSummary = { applied: 0 };
  project.passes[pass] = summary;
  try {
    if (baselineSql !== undefined) {
      const admin = await db.connect("supabase_admin");
      try {
        await admin.query(baselineSql);
      } finally {
        await admin.end();
      }
    }
    client = await db.connect("postgres");
    const policy =
      pass === "c"
        ? resolvePolicy(Object.fromEntries(RULES.map((r) => [r, "error"])))
        : pass === "d"
          ? resolvePolicy(
              Object.fromEntries(CORE_RULES.map((r) => [r, "error"])),
            )
          : resolvePolicy({});
    const options = {
      exposedSchemas: project.exposedSchemas,
      ...(pass === "a" ? { skipChecks: true } : {}),
    };
    if (pass !== "a") {
      summary.checkBytes = buildCheckBlock(policy, options).length;
      summary.readBytes = buildAfterCommitRead(policy, options).sql.length;
    }
    let seen = new Set<string>();
    for (const [index, file] of migrations.entries()) {
      const record = project.files[index]!;
      const result = await applyMigrationLikeCli(client, file, policy, options);
      record.ms[pass] = result.ms;
      let outcome: string = result.outcome;
      if (result.outcome === "apply_error") {
        (record.error ??= {})[pass] =
          `${result.error.code ?? ""} ${result.error.message}`
            .trim()
            .slice(0, 300);
      }
      if (result.outcome === "blocked" && result.check.kind === "blocked") {
        record.blockedBy[pass] = objectsOf(result.check.errors);
      }
      // (c)/(d) read only after split files, so their apply timings stay clean.
      if (
        result.outcome === "applied" &&
        (pass === "b" || (pass !== "a" && result.split))
      ) {
        const start = performance.now();
        const findings = await readFindings(
          client,
          policy,
          project.exposedSchemas,
        );
        if (pass === "b") {
          record.readMs = Math.round(performance.now() - start);
          const keys = new Set(findings.map(findingKey));
          record.introduced = [...keys]
            .filter((k) => !seen.has(k))
            .map((k) => k.split(" ").slice(0, 2).join(" "));
          seen = keys;
        }
        if (result.split && findings.length > 0)
          outcome = "applied_with_findings";
        if (result.split && findings.some((f) => f.severity === "error")) {
          record.blockedBy[pass] = objectsOf(
            findings.filter((f) => f.severity === "error"),
          );
        }
      }
      record.outcome[pass] = outcome;
      if (result.outcome !== "applied") {
        summary.stoppedAt = `${file.version}_${file.name}.sql`;
        summary.stopReason = outcome;
        for (const later of project.files.slice(index + 1))
          later.outcome[pass] = "not_run";
        break;
      }
      summary.applied += 1;
    }
    summary.historyRows = Number(
      (
        await client.query(
          "select count(*) from supabase_migrations.schema_migrations",
        )
      ).rows[0].count,
    );
    const fp = (await client.query(CATALOG_FINGERPRINT)).rows[0];
    summary.fingerprint = {
      md5: fp.md5,
      classes: Number(fp.classes),
      procs: Number(fp.procs),
      policies: Number(fp.policies),
    };
    if (pass === "b") {
      summary.finalFindings = countByRule(
        await readFindings(client, resolvePolicy({}), project.exposedSchemas),
      );
    }
  } finally {
    await client?.end().catch(() => {});
    await db.stop().catch(() => {});
  }
}

function analyze(project: ProjectRecord): void {
  const { a, b } = project.passes;
  for (const file of project.files) {
    const [oa, ob] = [file.outcome.a, file.outcome.b];
    if (oa === "applied" && ob === "apply_error") {
      project.anomalies.push(
        `${file.file}: applies in (a) but errors in (b): ${file.error?.b}`,
      );
    }
    if (oa === "apply_error" && ob?.startsWith("applied")) {
      project.anomalies.push(`${file.file}: errors in (a) but applies in (b)`);
    }
    for (const pass of ["c", "d"] as const) {
      if (file.outcome[pass] === "apply_error" && oa === "applied") {
        project.anomalies.push(
          `${file.file}: applies in (a) but errors in (${pass}) for a non-check reason: ${file.error?.[pass]}`,
        );
      }
      if (file.outcome[pass] === "timed_out")
        project.anomalies.push(`${file.file}: check timed out in (${pass})`);
    }
  }
  if (a && b) {
    if (a.applied !== b.applied)
      project.anomalies.push(
        `(a) applied ${a.applied} files, (b) ${b.applied}`,
      );
    if (a.fingerprint?.md5 !== b.fingerprint?.md5) {
      project.anomalies.push(
        `catalog of (b) differs from (a): ${JSON.stringify(a.fingerprint)} vs ${JSON.stringify(b.fingerprint)}`,
      );
    }
  }
  for (const pass of ["b", "c", "d"] as const) {
    const summary = project.passes[pass];
    if (summary && summary.historyRows !== summary.applied) {
      project.anomalies.push(
        `(${pass}) history has ${summary.historyRows} rows for ${summary.applied} applied files`,
      );
    }
    if (
      a &&
      summary &&
      summary.stoppedAt === undefined &&
      a.stoppedAt === undefined &&
      a.fingerprint?.md5 !== summary.fingerprint?.md5
    ) {
      project.anomalies.push(
        `catalog of (${pass}) differs from (a) though (${pass}) stopped nowhere`,
      );
    }
  }
}

async function runProject(name: string): Promise<ProjectRecord> {
  const scratch = join(outDir, "projects", name, "supabase");
  cpSync(join(values.samples, name, "supabase"), scratch, { recursive: true });
  const migrations = loadMigrations(scratch);
  const project: ProjectRecord = {
    project: name,
    exposedSchemas: exposedSchemas(scratch),
    files: migrations.map((m) => ({
      file: `${m.version}_${m.name}.sql`,
      split: splitReason(m),
      outcome: {},
      ms: {},
      blockedBy: {},
    })),
    passes: {},
    anomalies: [],
  };
  if (migrations.length === 0) return project;
  const start = performance.now();
  const results = await Promise.allSettled(
    PASSES.map((pass) => runPass(pass, project, migrations)),
  );
  project.wallMs = Math.round(performance.now() - start);
  const failed = results.flatMap((r, i) =>
    r.status === "rejected"
      ? [`(${PASSES[i]}) ${String(r.reason).slice(0, 300)}`]
      : [],
  );
  if (failed.length > 0) project.envError = failed.join("; ");
  analyze(project);
  return project;
}

const allProjects = readdirSync(values.samples, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() && existsSync(join(values.samples, d.name, "supabase")),
  )
  .map((d) => d.name)
  .sort();
const migrationCount = (name: string) => {
  const dir = join(values.samples, name, "supabase", "migrations");
  return existsSync(dir) ? readdirSync(dir).length : 0;
};
// Largest first, so the long replays start before the budget runs out.
const selected = (
  values.projects ? values.projects.split(",") : allProjects
).sort((x, y) => migrationCount(y) - migrationCount(x));
const projects: ProjectRecord[] = [];
const skipped: string[] = [];
const queue = [...selected];
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      if (Date.now() > deadline) {
        skipped.push(name);
        continue;
      }
      console.error(`[${new Date().toISOString()}] start ${name}`);
      const record = await runProject(name).catch(
        (error: unknown): ProjectRecord => ({
          project: name,
          exposedSchemas: [],
          files: [],
          passes: {},
          anomalies: [],
          envError: String(error).slice(0, 300),
        }),
      );
      projects.push(record);
      writeFileSync(
        join(outDir, "report.json"),
        JSON.stringify({ image, projects, skipped }, null, 2),
      );
      console.error(
        `[${new Date().toISOString()}] done ${name}: ${record.files.length} files, a=${record.passes.a?.applied} b=${record.passes.b?.applied} c=${record.passes.c?.applied}${record.passes.c?.stopReason ? ` (${record.passes.c.stopReason})` : ""}, ${record.anomalies.length} anomalies`,
      );
    }
  }),
);
projects.sort((x, y) => x.project.localeCompare(y.project));

// ---- report ----
const files = projects.flatMap((p) =>
  p.files.map((f) => ({ ...f, project: p.project })),
);
const count = (pass: Pass, outcome: string) =>
  files.filter((f) => f.outcome[pass] === outcome).length;
const percentile = (xs: number[], p: number) => {
  const sorted = [...xs].sort((x, y) => x - y);
  return sorted.length === 0
    ? 0
    : (sorted[
        Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
      ] ?? 0);
};
const stats = (xs: number[]) =>
  `p50 ${percentile(xs, 50)} ms, p95 ${percentile(xs, 95)} ms, max ${Math.max(0, ...xs)} ms (n=${xs.length})`;
const readMs = files.flatMap((f) => (f.readMs === undefined ? [] : [f.readMs]));
const overheads = (pass: "c" | "d") =>
  files.flatMap((f) =>
    f.outcome.a === "applied" && f.outcome[pass] === "applied" && !f.split
      ? [(f.ms[pass] ?? 0) - (f.ms.a ?? 0)]
      : [],
  );
const tally = (entries: Iterable<string>) => {
  const map = new Map<string, number>();
  for (const e of entries) map.set(e, (map.get(e) ?? 0) + 1);
  return map;
};
const introducedByRule = tally(
  files.flatMap((f) => (f.introduced ?? []).map(ruleOf)),
);
const finalByRule = new Map<string, number>();
for (const p of projects)
  for (const [r, n] of Object.entries(p.passes.b?.finalFindings ?? {}))
    finalByRule.set(r, (finalByRule.get(r) ?? 0) + n);
const blockedFile = (p: ProjectRecord, pass: "c" | "d") =>
  p.files.find((f) => f.outcome[pass] === "blocked");
const blockingByRule = (pass: "c" | "d") =>
  tally(
    projects.flatMap((p) => [
      ...new Set((blockedFile(p, pass)?.blockedBy[pass] ?? []).map(ruleOf)),
    ]),
  );
const [blockingC, blockingD] = [blockingByRule("c"), blockingByRule("d")];
const preexisting = files.filter((f) => f.outcome.a === "apply_error");
const splitFiles = files.filter((f) => f.split);
const outcomes = [
  "applied",
  "applied_with_findings",
  "blocked",
  "timed_out",
  "apply_error",
  "not_run",
];

const lines: string[] = [];
lines.push(`# pg-checks dogfood (${new Date().toISOString()})`, "");
lines.push(
  `- Image: \`${image}\`, splinter ${SPLINTER_VERSION}, executor: CLI-faithful pipeline (tests/cli-executor.ts), role \`postgres\``,
);
lines.push(
  `- Starting state: ${baselinePath === undefined ? "bare image" : `bare image + \`${baselinePath.split("/packages/").at(-1)}\` (bare → \`supabase start\` delta)`}`,
);
lines.push(
  "- Passes: (a) no check; (b) all rules warn + after-commit read per file; (c) all rules error; (d) four core rules error, rest warn. Each pass stops at its first failing file, like the CLI.",
);
lines.push(
  `- Projects: ${projects.length} run${skipped.length ? `, ${skipped.length} skipped (budget): ${skipped.join(", ")}` : ""}; files: ${files.length}`,
);
lines.push("", "## Totals", "");
lines.push(
  "| Outcome | (a) baseline | (b) warn | (c) all error | (d) core error |",
  "| -- | -- | -- | -- | -- |",
);
for (const outcome of outcomes) {
  lines.push(
    `| ${outcome} | ${PASSES.map((pass) => count(pass, outcome)).join(" | ")} |`,
  );
}
lines.push("");
lines.push(
  `- Pre-existing failures (file errors in the baseline too, environment or project bugs): ${preexisting.length} files in ${new Set(preexisting.map((f) => f.project)).size} projects.`,
);
lines.push(
  `- Split files (D22, no in-transaction check): ${splitFiles.length} (${["transaction_control", "pipeline_incompatible", "directive"].map((r) => `${r}: ${splitFiles.filter((f) => f.split === r).length}`).join(", ")}).`,
);
lines.push(
  `- After-commit read of all 9 rules (≈ check cost) per file, pass (b): ${stats(readMs)}.`,
);
lines.push(
  `- Per-file apply overhead vs (a), files applied in both: (c) ${stats(overheads("c"))}; (d) ${stats(overheads("d"))}. Passes run on concurrent containers, so this is noisy.`,
);
const bytes = (pass: Pass, key: "checkBytes" | "readBytes") =>
  [...new Set(projects.flatMap((p) => p.passes[pass]?.[key] ?? []))].sort(
    (x, y) => x - y,
  );
const range = (xs: number[]) =>
  xs.length === 0
    ? "-"
    : xs.length === 1
      ? `${xs[0]}`
      : `${xs[0]}–${xs.at(-1)}`;
lines.push(
  `- SQL the check adds per transactional file, bytes (range over projects' exposed schemas): (c) ${range(bytes("c", "checkBytes"))}; (d) ${range(bytes("d", "checkBytes"))}. After-commit read: (b) ${range(bytes("b", "readBytes"))}.`,
);
lines.push("", "## Findings by rule", "");
lines.push(
  "| Rule | (b) final state, all projects | (b) files introducing one | (c) projects blocked by it | (d) projects blocked by it |",
  "| -- | -- | -- | -- | -- |",
);
for (const rule of RULES) {
  lines.push(
    `| ${rule} | ${finalByRule.get(rule) ?? 0} | ${introducedByRule.get(rule) ?? 0} | ${blockingC.get(rule) ?? 0} | ${blockingD.get(rule) ?? 0} |`,
  );
}
lines.push("", "## Projects", "");
lines.push(
  "| Project | Files | Exposed | (a) applied / stop | (b) applied, final findings | (c) applied / stop | (d) applied / stop (blocking objects) | Split | Anomalies |",
  "| -- | -- | -- | -- | -- | -- | -- | -- | -- |",
);
for (const p of projects) {
  const { a, b, c, d } = p.passes;
  const stop = (s?: PassSummary) =>
    s?.stoppedAt ? ` / ${s.stopReason} at \`${s.stoppedAt}\`` : "";
  const dObjects = blockedFile(p, "d")?.blockedBy.d ?? [];
  const findings = Object.values(b?.finalFindings ?? {}).reduce(
    (x, y) => x + y,
    0,
  );
  lines.push(
    `| ${p.project} | ${p.files.length} | ${p.exposedSchemas.join(", ")} | ${a?.applied ?? "-"}${stop(a)} | ${b?.applied ?? "-"}, ${findings} | ${c?.applied ?? "-"}${stop(c)} | ${d?.applied ?? "-"}${stop(d)}${dObjects.length ? ` (${dObjects.slice(0, 4).join("; ")}${dObjects.length > 4 ? `; +${dObjects.length - 4}` : ""})` : ""} | ${p.files.filter((f) => f.split).length} | ${p.anomalies.length + (p.envError ? 1 : 0)} |`,
  );
}
lines.push("", "## Anomalies and environment errors", "");
for (const p of projects) {
  for (const a of p.anomalies) lines.push(`- ${p.project}: ${a}`);
  if (p.envError)
    lines.push(`- ${p.project}: environment error: ${p.envError}`);
}
lines.push(
  "",
  "## Baseline failures (pre-existing, not caused by the check)",
  "",
);
for (const f of preexisting)
  lines.push(`- ${f.project} \`${f.file}\`: ${f.error?.a}`);
lines.push("", "## Split files", "");
for (const f of splitFiles)
  lines.push(
    `- ${f.project} \`${f.file}\`: ${f.split}; (b) ${f.outcome.b ?? "-"}, (c) ${f.outcome.c ?? "-"}, (d) ${f.outcome.d ?? "-"}${f.blockedBy.d ? `, (d) error findings: ${f.blockedBy.d.length}` : ""}`,
  );
writeFileSync(join(outDir, "REPORT.md"), `${lines.join("\n")}\n`);
writeFileSync(
  join(outDir, "report.json"),
  JSON.stringify(
    {
      image,
      splinter: SPLINTER_VERSION,
      baseline: baselinePath ?? null,
      projects,
      skipped,
    },
    null,
    2,
  ),
);
console.log(join(outDir, "REPORT.md"));
