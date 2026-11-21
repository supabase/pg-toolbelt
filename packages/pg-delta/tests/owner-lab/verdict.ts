/**
 * Pure helpers for owner-lab: ideal resolution, verdicts, baseline keys and a
 * statement-list diff. No I/O, no src/ imports, so it runs against any tree.
 */

export type Ideal = "converge" | "refuse";
export type IdealSpec = Ideal | { forward?: Ideal; reverse?: Ideal };

export interface IdealMeta {
  ideal?: IdealSpec;
  /** alias of `ideal` (older scenarios) */
  expect?: IdealSpec;
  /** `{ "<=15": …, ">=16": … }`; overrides `ideal` when the server major matches */
  idealByMajor?: Record<string, IdealSpec>;
}

function majorMatches(key: string, major: number): boolean {
  const m = /^\s*(<=|>=|<|>|=)?\s*(\d+)\s*$/.exec(key);
  if (!m) throw new Error(`bad idealByMajor key ${JSON.stringify(key)}`);
  const n = Number(m[2]);
  switch (m[1] ?? "=") {
    case "<=":
      return major <= n;
    case ">=":
      return major >= n;
    case "<":
      return major < n;
    case ">":
      return major > n;
    default:
      return major === n;
  }
}

export function resolveIdeal(
  meta: IdealMeta,
  major: number,
  direction: "forward" | "reverse",
): Ideal {
  let spec: IdealSpec = meta.ideal ?? meta.expect ?? "converge";
  for (const [key, value] of Object.entries(meta.idealByMajor ?? {}))
    if (majorMatches(key, major)) spec = value;
  if (typeof spec === "string") return spec;
  return spec[direction] ?? "converge";
}

const APPLIED = new Set([
  "OK",
  "FACT_DRIFT",
  "CATALOG_DRIFT",
  "FACT_DRIFT+CATALOG_DRIFT",
]);

export interface VerdictInput {
  outcome: string;
  flags: readonly string[];
  ideal: Ideal;
  segments: number;
  /** APPLY_FAIL only */
  failClean?: "clean" | "dirty";
  /** the plan-time error was a typed capability/identity error */
  typedError: boolean;
}

export function computeVerdict(i: VerdictInput): string {
  const { outcome, flags } = i;
  if (
    outcome === "SETUP_FAIL" ||
    outcome === "SKIPPED" ||
    outcome === "HARNESS_ERROR"
  )
    return "NA";
  if (flags.includes("ROLE_LEFT")) return "SILENT";
  if (APPLIED.has(outcome)) {
    if (flags.includes("DATA_LOSS")) return "SILENT";
    if (outcome === "CATALOG_DRIFT") return "SILENT";
    if (outcome.includes("FACT_DRIFT")) return "NONCONVERGED";
    return i.ideal === "refuse" ? "UNEXPECTED_OK" : "PASS";
  }
  if (outcome === "APPLY_FAIL") {
    if (i.failClean === "dirty")
      return i.segments > 1 ? "LOUD(dirty-multisegment)" : "SILENT";
    return "LOUD";
  }
  if (outcome === "BLOCKED" || outcome === "REFUSED_IDENTITY")
    return i.ideal === "refuse" ? "PASS" : "LOUD";
  if (outcome === "PLAN_THROW")
    return i.ideal === "refuse" && i.typedError ? "PASS" : "LOUD";
  return "NA";
}

export interface BaselineKey {
  scenario: string;
  direction: string;
  image: string;
  applier: string;
  login: string;
  via: string;
  supabase: boolean;
}

export function baselineKey(k: BaselineKey): string {
  return [
    k.scenario,
    k.direction,
    k.image,
    k.applier,
    k.login,
    k.via,
    k.supabase ? "supabase" : "stock",
  ].join("|");
}

/** Unified-style diff of two statement lists (statements are atomic units;
 *  multi-line statements print one line each with the same marker). */
export function statementDiff(
  base: readonly string[],
  cur: readonly string[],
): string[] {
  const n = base.length;
  const m = cur.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        base[i] === cur[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: { op: " " | "-" | "+"; s: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === cur[j]) {
      ops.push({ op: " ", s: base[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!)
      ops.push({ op: "-", s: base[i++]! });
    else ops.push({ op: "+", s: cur[j++]! });
  }
  while (i < n) ops.push({ op: "-", s: base[i++]! });
  while (j < m) ops.push({ op: "+", s: cur[j++]! });
  const out: string[] = ["--- baseline", "+++ current"];
  // context: one unchanged statement on each side of a change
  const keep = ops.map(
    (o, k) =>
      o.op !== " " ||
      ops[k - 1]?.op === "-" ||
      ops[k - 1]?.op === "+" ||
      ops[k + 1]?.op === "-" ||
      ops[k + 1]?.op === "+",
  );
  let gap = false;
  ops.forEach((o, k) => {
    if (!keep[k]) {
      gap = true;
      return;
    }
    if (gap) out.push("@@ ...");
    gap = false;
    for (const line of o.s.split("\n")) out.push(`${o.op}${line}`);
  });
  return out;
}

// ── reference (superuser) comparison ─────────────────────────────────────────

/** Normalise a catalog-truth line for the main-vs-reference comparison: in
 *  `member` lines the grantor is the applier or the bootstrap superuser (same
 *  token), and rows whose MEMBER is the bootstrap superuser are dropped (null).
 *  Owner and ACL lines (including grantors) are untouched. */
export function normalizeRefLine(
  line: string,
  applier: string,
  bootstrap: string,
): string | null {
  if (!line.startsWith("member ")) return line;
  const m = /^member (.+?) <- (.+?) (admin=.*?)(?: grantor=(.+))?$/.exec(line);
  if (!m) return line;
  const [, role, member, opts, grantor] = m;
  if (member === bootstrap) return null;
  const g =
    grantor === undefined
      ? ""
      : grantor === applier || grantor === bootstrap
        ? " grantor=*"
        : ` grantor=${grantor}`;
  return `member ${role} <- ${member} ${opts}${g}`;
}

export function normalizeRefLines(
  lines: readonly string[],
  applier: string,
  bootstrap: string,
): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    const n = normalizeRefLine(l, applier, bootstrap);
    if (n !== null) out.add(n);
  }
  return out;
}

export interface RefineInput {
  verdict: string;
  outcome: string;
  flags: readonly string[];
  /** reference outcome: REF_OK | REF_NONCONVERGED | REF_APPLY_FAIL | REF_PLAN_THROW */
  refOutcome: string;
  /** main result == reference result after normalisation */
  sameResult: boolean;
  /** same DATA_LOSS table set in main and reference */
  sameDataLoss: boolean;
}

/** Re-judge a createrole run against the superuser reference. */
export function refineVerdict(i: RefineInput): {
  verdict: string;
  addFlags: string[];
} {
  const refApplied =
    i.refOutcome === "REF_OK" || i.refOutcome === "REF_NONCONVERGED";
  const applied = APPLIED.has(i.outcome);
  if (applied) {
    if (i.flags.includes("ROLE_LEFT"))
      return { verdict: i.verdict, addFlags: [] };
    if (i.verdict === "NONCONVERGED")
      return {
        verdict: i.verdict,
        addFlags: i.sameResult && refApplied ? ["SAME_AS_SUPERUSER"] : [],
      };
    if (i.verdict === "SILENT") {
      if (refApplied && i.sameResult && i.sameDataLoss)
        return { verdict: "ENGINE_GAP", addFlags: [] };
      return { verdict: "SILENT", addFlags: [] };
    }
    return { verdict: i.verdict, addFlags: [] };
  }
  if (
    i.verdict === "LOUD" &&
    (i.refOutcome === "REF_APPLY_FAIL" || i.refOutcome === "REF_PLAN_THROW")
  )
    return { verdict: "LOUD_ENGINE", addFlags: [] };
  return { verdict: i.verdict, addFlags: [] };
}

/** Split SQL text into statements the way psql does: on `;` outside quotes,
 *  dollar quotes and comments. The `;` stays with its statement. */
export function splitSqlStatements(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    const c2 = text[i + 1];
    if (c === "-" && c2 === "-") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && c2 === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (text[i] === c) {
          if (text[i + 1] === c) i += 2;
          else break;
        } else i++;
      }
      i++;
    } else if (c === "$") {
      const m = /^\$[A-Za-z_\u0080-￿]*[A-Za-z0-9_\u0080-￿]*\$/.exec(
        text.slice(i, i + 80),
      );
      if (m && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!))) {
        const end = text.indexOf(m[0], i + m[0].length);
        i = end === -1 ? n : end + m[0].length;
      } else i++;
    } else if (c === ";") {
      i++;
      out.push(text.slice(start, i));
      start = i;
    } else i++;
  }
  const rest = text.slice(start);
  if (rest.replace(/--[^\n]*/g, "").trim() !== "") out.push(rest);
  return out;
}
