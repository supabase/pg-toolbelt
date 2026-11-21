/**
 * Merge and summarise the sharded owner-lab results of .github/workflows/owner-lab.yml.
 *
 *   bun tests/owner-lab/ci-summary.ts <dir>   # Markdown report on stdout
 *
 * <dir> holds the downloaded artifacts: `lab-<config>-<i>of<n>/<kind>.jsonl`,
 * where kind is `base`, `union` (the real pass) or an ablation mode (`nopin`,
 * `nowrap`, `nomoves`, ...) that switches one mechanism off. Modes are
 * discovered from the files present, `union` first, the rest sorted by name.
 * Merged per-config files are written to `<dir>/merged/<kind>-<config>.jsonl`.
 * Exit code 1 on a missing shard or when `union` has a SILENT or REGRESSION
 * run in a non-superuser config. Ablation modes and PLAN_CHANGED never affect
 * the exit code.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

type Kind = string;

interface Run {
  scenario: string;
  direction: string;
  outcome: string;
  verdict: string;
  detail: string;
  flags: string[];
  plan: string[];
}

const COLUMNS = [
  "PASS",
  "ENGINE_GAP",
  "LOUD",
  "LOUD_ENGINE",
  "NONCONVERGED",
  "SILENT",
  "REGRESSION",
  "PLAN_CHANGED",
  "UNEXPECTED_OK",
  "NA",
] as const;
const DIRTY = "LOUD(dirty-multisegment)";
const LISTED = [
  "SILENT",
  "REGRESSION",
  "PLAN_CHANGED",
  "NONCONVERGED",
  "UNEXPECTED_OK",
] as const;
const LOUD_VERDICTS = new Set(["LOUD", "LOUD_ENGINE", DIRTY]);

const GROUPS: { title: string; test: (c: string) => boolean }[] = [
  { title: "Stock, createrole applier", test: (c) => /^pg\d+$/.test(c) },
  { title: "Stock, step-down login", test: (c) => c.endsWith("-stepdown") },
  { title: "Stock, script apply", test: (c) => c.endsWith("-script") },
  { title: "Stock, superuser applier", test: (c) => c.endsWith("-superuser") },
  { title: "Supabase images", test: (c) => c.startsWith("supa") },
];
const groupOf = (config: string) =>
  GROUPS.find((g) => g.test(config))?.title ?? "Other";
const isSuperuser = (config: string) => config.endsWith("-superuser");

function readJsonl(path: string): Run[] {
  const runs: Run[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as Partial<Run>;
      runs.push({
        scenario: String(d.scenario ?? "?"),
        direction: String(d.direction ?? "?"),
        outcome: String(d.outcome ?? "?"),
        verdict: String(d.verdict ?? "?"),
        detail: String(d.detail ?? ""),
        flags: Array.isArray(d.flags) ? d.flags.map(String) : [],
        plan: Array.isArray(d.plan) ? d.plan.map(String) : [],
      });
    } catch {
      // a truncated last line from a killed shard: skip it
    }
  }
  return runs;
}

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error("usage: bun ci-summary.ts <artifact-dir>");
  process.exit(2);
}

// config -> shard index -> kinds present; config -> expected shard count
const shardsSeen = new Map<string, Map<number, Set<Kind>>>();
const shardTotal = new Map<string, number>();
const rawLines = new Map<string, string[]>(); // `${kind}\0${config}` -> lines
for (const name of readdirSync(dir).sort()) {
  const m = /^lab-(.+)-(\d+)of(\d+)$/.exec(name);
  if (!m) continue;
  const [, config, i, n] = m as unknown as [string, string, string, string];
  const shards = shardsSeen.get(config) ?? new Map<number, Set<Kind>>();
  shardsSeen.set(config, shards);
  const kinds = new Set<Kind>();
  shards.set(Number(i), kinds);
  shardTotal.set(config, Math.max(shardTotal.get(config) ?? 0, Number(n)));
  for (const f of readdirSync(join(dir, name)).sort()) {
    if (!f.endsWith(".jsonl")) continue;
    const kind = f.slice(0, -".jsonl".length);
    const file = join(dir, name, f);
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim());
    if (lines.length === 0) continue;
    kinds.add(kind);
    const key = `${kind}\0${config}`;
    rawLines.set(key, [...(rawLines.get(key) ?? []), ...lines]);
  }
}

const configs = [...shardsSeen.keys()].sort();
mkdirSync(join(dir, "merged"), { recursive: true });
const runs = new Map<string, Run[]>(); // `${kind}\0${config}`
for (const [key, lines] of rawLines) {
  const [kind, config] = key.split("\0") as [string, string];
  writeFileSync(
    join(dir, "merged", `${kind}-${config}.jsonl`),
    `${lines.join("\n")}\n`,
  );
  runs.set(key, readJsonl(join(dir, "merged", `${kind}-${config}.jsonl`)));
}
const get = (kind: Kind, config: string): Run[] =>
  runs.get(`${kind}\0${config}`) ?? [];
// Modes (everything but base) are whatever any shard of the config produced;
// union is always expected and always first.
const modesOf = (config: string): Kind[] => {
  const found = new Set<Kind>();
  for (const kinds of shardsSeen.get(config)?.values() ?? [])
    for (const k of kinds) if (k !== "base") found.add(k);
  found.delete("union");
  return ["union", ...[...found].sort()];
};
const ablationsOf = (config: string): Kind[] =>
  modesOf(config).filter((m) => m !== "union");
const kindsOf = (config: string): Kind[] => ["base", ...modesOf(config)];

// Missing shards. The expected count is the largest `n` seen for the group.
const groupTotal = new Map<string, number>();
for (const c of configs) {
  const g = groupOf(c);
  groupTotal.set(g, Math.max(groupTotal.get(g) ?? 0, shardTotal.get(c) ?? 0));
}
const missing: string[] = [];
for (const c of configs) {
  const total = groupTotal.get(groupOf(c)) ?? 0;
  const shards = shardsSeen.get(c) ?? new Map();
  for (let i = 1; i <= total; i++) {
    const have = shards.get(i);
    if (!have) {
      missing.push(`${c} shard ${i}/${total}: artifact missing`);
      continue;
    }
    for (const k of kindsOf(c)) {
      if (!have.has(k))
        missing.push(`${c} shard ${i}/${total}: ${k}.jsonl missing or empty`);
    }
  }
}
if (configs.length === 0) missing.push("no lab-* artifacts found in " + dir);

function counts(rs: Run[]): Map<string, number> {
  const c = new Map<string, number>();
  const bump = (k: string) => c.set(k, (c.get(k) ?? 0) + 1);
  for (const r of rs) {
    bump(r.verdict);
    if (r.flags.includes("PLAN_CHANGED")) bump("PLAN_CHANGED");
  }
  return c;
}

const norm = (detail: string) =>
  detail
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\d+/g, "N")
    .slice(0, 200);
const oneLine = (s: string, n = 200) =>
  `\`${s.replace(/\s+/g, " ").replace(/`/g, "'").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, n)}\``;

const hasStatus = (r: Run, status: string) =>
  status === "PLAN_CHANGED"
    ? r.flags.includes("PLAN_CHANGED")
    : r.verdict === status;

const out: string[] = [];
const emit = (s = "") => out.push(s);

emit("# Owner lab results");
emit();
if (missing.length) {
  emit("## MISSING SHARDS");
  emit();
  for (const m of missing) emit(`- **${m}**`);
  emit();
}

// 1. Count tables
for (const g of [...GROUPS.map((x) => x.title), "Other"]) {
  const members = configs.filter((c) => groupOf(c) === g);
  if (members.length === 0) continue;
  const dirtyAny = members.some((c) =>
    kindsOf(c).some((k) => (counts(get(k, c)).get(DIRTY) ?? 0) > 0),
  );
  const cols: string[] = [...COLUMNS];
  if (dirtyAny) cols.splice(3, 0, DIRTY);
  emit(`## ${g}`);
  emit();
  emit(`| config | kind | runs | ${cols.join(" | ")} |`);
  emit(`| --- | --- | ---: | ${cols.map(() => "---:").join(" | ")} |`);
  for (const c of members) {
    for (const k of kindsOf(c)) {
      const rs = get(k, c);
      const cnt = counts(rs);
      const cell = (col: string) => {
        const n = cnt.get(col) ?? 0;
        return n === 0
          ? "0"
          : ["SILENT", "REGRESSION"].includes(col)
            ? `**${n}**`
            : String(n);
      };
      emit(`| ${c} | ${k} | ${rs.length} | ${cols.map(cell).join(" | ")} |`);
    }
  }
  emit();
}

// 2. Per config and mode details
emit("## Details per config and mode");
emit();
for (const c of configs) {
  for (const mode of modesOf(c)) {
    const rs = get(mode, c);
    if (rs.length === 0) continue;
    emit(`### ${c} / ${mode}`);
    emit();
    for (const status of LISTED) {
      const hit = rs.filter((r) => hasStatus(r, status));
      if (hit.length === 0) continue;
      emit(`<details><summary>${status} (${hit.length})</summary>`);
      emit();
      for (const r of hit) {
        emit(
          `- \`${r.scenario}\` (${r.direction}) ${r.outcome}: ${oneLine(r.detail)}`,
        );
      }
      emit();
      emit("</details>");
      emit();
    }
    const loud = new Map<string, { n: number; example: string }>();
    for (const r of rs) {
      if (!LOUD_VERDICTS.has(r.verdict)) continue;
      const key = `${r.verdict}: ${norm(r.detail)}`;
      const e = loud.get(key) ?? {
        n: 0,
        example: `${r.scenario} (${r.direction})`,
      };
      e.n++;
      loud.set(key, e);
    }
    if (loud.size) {
      const top = [...loud].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
      emit(
        `<details><summary>LOUD causes (${loud.size} distinct, top ${top.length})</summary>`,
      );
      emit();
      for (const [key, e] of top)
        emit(`- ${e.n}x ${oneLine(key)} e.g. \`${e.example}\``);
      emit();
      emit("</details>");
      emit();
    }
  }
}

// 3. What each mechanism buys
const key = (r: Run) => `${r.scenario}\0${r.direction}`;
emit("## What each mechanism buys (union vs ablation)");
emit();
const ablationModes = [
  ...new Set(configs.flatMap((c) => ablationsOf(c))),
].sort();
if (ablationModes.length === 0) {
  emit("No ablation mode ran.");
  emit();
}
const summaryRows: string[] = [];
for (const m of ablationModes) {
  for (const c of configs) {
    if (!ablationsOf(c).includes(m)) continue;
    const u = new Map(get("union", c).map((r) => [key(r), r]));
    const a = new Map(get(m, c).map((r) => [key(r), r]));
    if (u.size === 0 || a.size === 0) continue;
    const groups = new Map<string, string[]>();
    let uOnly = 0;
    let aOnly = 0;
    for (const [k, ur] of u) {
      const ar = a.get(k);
      if (!ar || ur.verdict === ar.verdict) continue;
      const [scenario, direction] = k.split("\0");
      const label = `${scenario} ${direction}`;
      if (ur.verdict === "PASS") uOnly++;
      if (ar.verdict === "PASS") aOnly++;
      const g = `union ${ur.verdict}, ${m} ${ar.verdict}: ${norm(
        ar.verdict === "PASS" ? ur.detail : ar.detail,
      )}`;
      groups.set(g, [...(groups.get(g) ?? []), label]);
    }
    const mc = counts(get(m, c));
    summaryRows.push(
      `| ${m} | ${c} | ${counts(get("union", c)).get("PASS") ?? 0} | ${mc.get("PASS") ?? 0} | ${uOnly} | ${aOnly} | ${mc.get("SILENT") ?? 0} | ${mc.get("REGRESSION") ?? 0} |`,
    );
    if (groups.size === 0) continue;
    const total = [...groups.values()].reduce((n, l) => n + l.length, 0);
    emit(
      `<details><summary>${m} / ${c}: ${total} runs where union and ${m} differ</summary>`,
    );
    emit();
    for (const [g, list] of [...groups].sort(
      (x, y) => y[1].length - x[1].length,
    )) {
      emit(`- ${list.length}x ${oneLine(g)}`);
      for (const l of list.slice(0, 5)) emit(`  - \`${l}\``);
      if (list.length > 5) emit(`  - ... ${list.length - 5} more`);
    }
    emit();
    emit("</details>");
    emit();
  }
}
if (summaryRows.length) {
  emit(
    "| ablation | config | union PASS | M PASS | runs union passes and M does not | runs M passes and union does not | M SILENT | M REGRESSION |",
  );
  emit("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of summaryRows) emit(row);
  emit();
}

// 4. Plans that use run-as
emit("## Plans that use run-as (union)");
emit();
const usesRunAs = (r: Run) => r.plan.some((e) => e.startsWith("[as "));
for (const c of configs) {
  const hit = get("union", c).filter(usesRunAs);
  const names = [...new Set(hit.map((r) => r.scenario))].sort();
  emit(
    `- ${c}: ${hit.length} runs, ${names.length} scenarios${names.length ? ` (${names.slice(0, 40).join(", ")}${names.length > 40 ? `, ... ${names.length - 40} more` : ""})` : ""}`,
  );
}
emit();

// 5. Verdict
const unsound = new Map<Kind, number>();
for (const c of configs) {
  if (isSuperuser(c)) continue;
  for (const mode of modesOf(c)) {
    unsound.set(
      mode,
      (unsound.get(mode) ?? 0) +
        get(mode, c).filter(
          (r) => r.verdict === "SILENT" || r.verdict === "REGRESSION",
        ).length,
    );
  }
}
const unionUnsound = unsound.get("union") ?? 0;
const planChanged = configs
  .filter(isSuperuser)
  .reduce(
    (n, c) =>
      n +
      get("union", c).filter((r) => r.flags.includes("PLAN_CHANGED")).length,
    0,
  );
const fail = missing.length > 0 || unionUnsound > 0;
const ablationInfo = [...unsound]
  .filter(([m]) => m !== "union")
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([m, n]) => `${m} ${n}`)
  .join(", ");

emit("## Verdict");
emit();
emit(
  `SILENT+REGRESSION (non-superuser configs): union ${unionUnsound}${ablationInfo ? `; ablations (informational): ${ablationInfo}` : ""}. PLAN_CHANGED in superuser configs: ${planChanged} (informational).`,
);
emit();
emit(
  fail
    ? `**FAIL**: ${[missing.length ? `${missing.length} missing shard file(s)` : "", unionUnsound > 0 ? `union has ${unionUnsound} SILENT/REGRESSION run(s)` : ""].filter(Boolean).join("; ")}`
    : "**OK**: no missing shards and union is free of SILENT / REGRESSION.",
);

console.log(out.join("\n"));
process.exit(fail ? 1 : 0);
