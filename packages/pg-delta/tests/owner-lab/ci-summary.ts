/**
 * Merge and summarise the sharded owner-lab results of .github/workflows/owner-lab.yml.
 *
 *   bun tests/owner-lab/ci-summary.ts <dir>   # Markdown report on stdout
 *
 * <dir> holds the downloaded artifacts: `lab-<config>-<i>of<n>/{base,union,runas}.jsonl`.
 * Merged per-config files are written to `<dir>/merged/<kind>-<config>.jsonl`.
 * Exit code 1 on a missing shard or when BOTH modes have a SILENT or
 * REGRESSION run in a non-superuser config; PLAN_CHANGED is only counted.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const KINDS = ["base", "union", "runas"] as const;
type Kind = (typeof KINDS)[number];
type Mode = "union" | "runas";

interface Run {
  scenario: string;
  direction: string;
  outcome: string;
  verdict: string;
  detail: string;
  flags: string[];
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
  for (const kind of KINDS) {
    const file = join(dir, name, `${kind}.jsonl`);
    if (!existsSync(file)) continue;
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
const modesOf = (config: string): Mode[] =>
  isSuperuser(config) ? ["union"] : ["union", "runas"];
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

// 3. union vs runas
emit("## union vs runas");
emit();
let anyDiff = false;
for (const c of configs) {
  if (isSuperuser(c)) continue;
  const u = new Map(
    get("union", c).map((r) => [`${r.scenario}\0${r.direction}`, r]),
  );
  const r2 = new Map(
    get("runas", c).map((r) => [`${r.scenario}\0${r.direction}`, r]),
  );
  if (u.size === 0 || r2.size === 0) continue;
  const groups = new Map<string, string[]>();
  for (const [key, a] of u) {
    const b = r2.get(key);
    if (!b) continue;
    const [scenario, direction] = key.split("\0");
    const label = `${scenario} (${direction})`;
    if (a.verdict === "PASS" && b.verdict !== "PASS") {
      const g = `union PASS, runas ${b.verdict}: ${norm(b.detail)}`;
      groups.set(g, [...(groups.get(g) ?? []), label]);
    } else if (b.verdict === "PASS" && a.verdict !== "PASS") {
      const g = `runas PASS, union ${a.verdict}: ${norm(a.detail)}`;
      groups.set(g, [...(groups.get(g) ?? []), label]);
    }
  }
  if (groups.size === 0) continue;
  anyDiff = true;
  const total = [...groups.values()].reduce((s, l) => s + l.length, 0);
  emit(`<details><summary>${c}: ${total} scenarios differ</summary>`);
  emit();
  for (const [g, list] of [...groups].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    emit(`- ${list.length}x ${oneLine(g)}`);
    for (const l of list.slice(0, 5)) emit(`  - \`${l}\``);
    if (list.length > 5) emit(`  - ... ${list.length - 5} more`);
  }
  emit();
  emit("</details>");
  emit();
}
if (!anyDiff) {
  emit("No scenario passes in one mode and not the other.");
  emit();
}

// 4. Verdict
const unsound: Record<Mode, number> = { union: 0, runas: 0 };
for (const c of configs) {
  if (isSuperuser(c)) continue;
  for (const mode of ["union", "runas"] as const) {
    unsound[mode] += get(mode, c).filter(
      (r) => r.verdict === "SILENT" || r.verdict === "REGRESSION",
    ).length;
  }
}
const planChanged = configs
  .filter(isSuperuser)
  .reduce(
    (s, c) =>
      s +
      get("union", c).filter((r) => r.flags.includes("PLAN_CHANGED")).length,
    0,
  );
const bothUnsound = unsound.union > 0 && unsound.runas > 0;
const fail = missing.length > 0 || bothUnsound;

emit("## Verdict");
emit();
emit(
  `SILENT+REGRESSION (non-superuser configs): union ${unsound.union}, runas ${unsound.runas}. PLAN_CHANGED in superuser configs: ${planChanged} (informational).`,
);
emit();
emit(
  fail
    ? `**FAIL**: ${[missing.length ? `${missing.length} missing shard file(s)` : "", bothUnsound ? "both modes are unsound" : ""].filter(Boolean).join("; ")}`
    : "**OK**: no missing shards and at least one mode is free of SILENT / REGRESSION.",
);

console.log(out.join("\n"));
process.exit(fail ? 1 : 0);
