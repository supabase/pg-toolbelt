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
