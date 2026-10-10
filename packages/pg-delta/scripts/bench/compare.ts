#!/usr/bin/env bun
/**
 * CI benchmark gate, verdict half: read ./run.ts output, decide per scenario
 * whether the head regressed against the base, and render a markdown report.
 *
 *   bun scripts/bench/compare.ts bench-results.json [--markdown report.md]
 *       [--accepted] [--base-ref <sha>] [--head-ref <sha>]
 *
 * Exits 1 on a regression, or when the base could not be measured at all,
 * unless `--accepted` (the PR carries the `perf-accepted` label). A head
 * scenario that errored or a crashed head worker always fails.
 *
 * Wall time is noisy on shared runners, so a time regression must clear three
 * bars at once: the median per-round head/base ratio exceeds `timeRatio`, the
 * absolute slowdown exceeds `minDeltaMs`, and at least `consistency` of the
 * interleaved rounds were slower. Round trips and bytes received are
 * deterministic for a fixed catalog, so they are compared exactly.
 */
import { parseArgs } from "node:util";
import {
  MIN_ROUNDS,
  type BenchResults,
  type ScenarioSample,
} from "./protocol.ts";

export interface Thresholds {
  timeRatio: number;
  minDeltaMs: number;
  consistency: number;
  bytesRatio: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  timeRatio: 0.15,
  minDeltaMs: 3,
  consistency: 0.8,
  bytesRatio: 0.05,
};

export type Verdict =
  | "regression"
  | "improvement"
  | "unchanged"
  | "new"
  | "unmeasured"
  | "error"
  | "insufficient";

export interface MetricComparison {
  metric: "time" | "round trips" | "connections" | "bytes received";
  base: number | null;
  head: number | null;
  verdict: Verdict;
  /** Time only: rounds where head was slower, out of paired rounds. */
  slower?: number;
  rounds?: number;
}

export interface ScenarioComparison {
  name: string;
  error?: string;
  metrics: MetricComparison[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sampleOf(
  output: BenchResults["rounds"][number]["base"],
  name: string,
): ScenarioSample | { error: string } | undefined {
  if (output === null) return { error: "worker process crashed" };
  return output[name];
}

const isSample = (
  value: ScenarioSample | { error: string } | undefined,
): value is ScenarioSample => value !== undefined && !("error" in value);

export function compare(
  results: BenchResults,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ScenarioComparison[] {
  const names = new Set<string>();
  for (const round of results.rounds) {
    for (const output of [round.head, round.base]) {
      for (const name of Object.keys(output ?? {})) names.add(name);
    }
  }

  if (names.size === 0) {
    return [
      {
        name: "all scenarios",
        error: "no worker produced results",
        metrics: [],
      },
    ];
  }

  // A scenario the base errors on is new in this PR, but only if the base
  // measured something else: a base that crashed or errored everywhere means
  // nothing was compared at all.
  const baseMeasured = results.rounds.some(
    (r) =>
      r.base !== null && Object.values(r.base).some((v) => !("error" in v)),
  );

  return [...names].map((name): ScenarioComparison => {
    const head = results.rounds.map((r) => sampleOf(r.head, name));
    const base = results.rounds.map((r) => sampleOf(r.base, name));
    const headError = head.find(
      (s): s is { error: string } => s !== undefined && "error" in s,
    );
    if (headError !== undefined || !head.some(isSample)) {
      return {
        name,
        error: headError?.error ?? "scenario missing from head",
        metrics: [],
      };
    }
    const headSamples = head.filter(isSample);
    const baseSamples = base.filter(isSample);
    if (baseSamples.length === 0) {
      return {
        name,
        metrics: [
          {
            metric: "time",
            base: null,
            head: median(headSamples.map((s) => median(s.ms))),
            verdict: baseMeasured ? "new" : "unmeasured",
          },
        ],
      };
    }

    const pairs = results.rounds.flatMap((_, i) => {
      const b = base[i];
      const h = head[i];
      return isSample(b) && isSample(h) ? [[median(b.ms), median(h.ms)]] : [];
    });
    const baseMs = median(pairs.map(([b]) => b!));
    const headMs = median(pairs.map(([, h]) => h!));
    const ratio = median(pairs.map(([b, h]) => h! / b!));
    const slower = pairs.filter(([b, h]) => h! > b!).length;
    const faster = pairs.filter(([b, h]) => h! < b!).length;
    const needed = Math.ceil(thresholds.consistency * pairs.length);
    let timeVerdict: Verdict = "unchanged";
    if (pairs.length < MIN_ROUNDS) timeVerdict = "insufficient";
    else if (
      ratio >= 1 + thresholds.timeRatio &&
      headMs - baseMs >= thresholds.minDeltaMs &&
      slower >= needed
    )
      timeVerdict = "regression";
    else if (
      ratio <= 1 / (1 + thresholds.timeRatio) &&
      baseMs - headMs >= thresholds.minDeltaMs &&
      faster >= needed
    )
      timeVerdict = "improvement";
    const metrics: MetricComparison[] = [
      {
        metric: "time",
        base: baseMs,
        head: headMs,
        verdict: timeVerdict,
        slower,
        rounds: pairs.length,
      },
    ];

    const all = (
      samples: ScenarioSample[],
      key: "roundTrips" | "connections" | "bytes",
    ) => samples.flatMap((s) => s[key] ?? []);
    for (const [key, metric] of [
      ["roundTrips", "round trips"],
      ["connections", "connections"],
    ] as const) {
      const baseCounts = all(baseSamples, key);
      const headCounts = all(headSamples, key);
      if (baseCounts.length === 0 || headCounts.length === 0) continue;
      const b = median(baseCounts);
      const h = median(headCounts);
      metrics.push({
        metric,
        base: b,
        head: h,
        verdict: h > b ? "regression" : h < b ? "improvement" : "unchanged",
      });
    }
    const baseBytes = all(baseSamples, "bytes");
    const headBytes = all(headSamples, "bytes");
    if (baseBytes.length > 0 && headBytes.length > 0) {
      const b = median(baseBytes);
      const h = median(headBytes);
      metrics.push({
        metric: "bytes received",
        base: b,
        head: h,
        verdict:
          h > b * (1 + thresholds.bytesRatio)
            ? "regression"
            : h < b * (1 - thresholds.bytesRatio)
              ? "improvement"
              : "unchanged",
      });
    }
    return { name, metrics };
  });
}

/** Regressions, unmeasured baselines, and timings with too few rounds to
 *  judge: what `perf-accepted` can waive. */
function waivable(comparisons: ScenarioComparison[]): number {
  return comparisons.reduce(
    (n, c) =>
      n +
      c.metrics.filter(
        (m) =>
          m.verdict === "regression" ||
          m.verdict === "unmeasured" ||
          m.verdict === "insufficient",
      ).length,
    0,
  );
}

const headErrors = (comparisons: ScenarioComparison[]): number =>
  comparisons.filter((c) => c.error !== undefined).length;

/** Everything the report flags, waivable or not. */
export function failures(comparisons: ScenarioComparison[]): number {
  return waivable(comparisons) + headErrors(comparisons);
}

export function gateFails(
  comparisons: ScenarioComparison[],
  accepted: boolean,
): boolean {
  return (
    headErrors(comparisons) > 0 || (!accepted && waivable(comparisons) > 0)
  );
}

export const REPORT_MARKER = "<!-- pg-delta-benchmark -->";

const VERDICT_LABEL: Record<Verdict, string> = {
  regression: "❌ regression",
  improvement: "🚀 improvement",
  unchanged: "≈",
  new: "🆕 no baseline",
  unmeasured: "❌ base not measured",
  error: "⚠️ error",
  insufficient: "❌ too few rounds",
};

function formatValue(metric: MetricComparison["metric"], v: number): string {
  if (metric === "time")
    return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(1)} ms`;
  if (metric === "bytes received")
    return v >= 1e6
      ? `${(v / 1e6).toFixed(2)} MB`
      : `${(v / 1e3).toFixed(1)} kB`;
  return String(v);
}

function formatChange(m: MetricComparison): string {
  if (m.base === null || m.head === null) return "";
  if (m.metric === "round trips" || m.metric === "connections") {
    const d = m.head - m.base;
    return d === 0 ? "0" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
  }
  const pct = ((m.head - m.base) / m.base) * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "±";
  const rounds =
    m.rounds !== undefined ? ` (${m.slower}/${m.rounds} rounds slower)` : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%${rounds}`;
}

export function renderMarkdown(
  comparisons: ScenarioComparison[],
  options: {
    accepted: boolean;
    meta: BenchResults["meta"];
    baseRef: string;
    headRef: string;
    thresholds?: Thresholds;
  },
): string {
  const t = options.thresholds ?? DEFAULT_THRESHOLDS;
  const failed = failures(comparisons);
  const status =
    failed === 0
      ? "✅ no significant regression"
      : gateFails(comparisons, options.accepted)
        ? `❌ ${failed} problem(s)`
        : `⚠️ ${failed} regression(s), accepted via \`perf-accepted\``;
  const lines = [
    REPORT_MARKER,
    `## pg-delta benchmark: ${status}`,
    "",
    `\`${options.baseRef}\` (base) → \`${options.headRef}\` (head) · ${options.meta.pgImage} · ${options.meta.rounds} interleaved rounds on one runner`,
    "",
    "| Scenario | Metric | Base | Head | Change | Verdict |",
    "|---|---|---:|---:|---:|---|",
  ];
  for (const c of comparisons) {
    if (c.error !== undefined) {
      lines.push(
        `| ${c.name} | | | | | ${VERDICT_LABEL.error}: ${c.error.replaceAll("|", "\\|").slice(0, 200)} |`,
      );
      continue;
    }
    for (const m of c.metrics) {
      lines.push(
        `| ${c.name} | ${m.metric} | ${m.base === null ? "–" : formatValue(m.metric, m.base)} | ${m.head === null ? "–" : formatValue(m.metric, m.head)} | ${formatChange(m)} | ${VERDICT_LABEL[m.verdict]} |`,
      );
    }
  }
  lines.push(
    "",
    "<details><summary>How this gate decides</summary>",
    "",
    `- **Wall time** (median of per-round medians) regresses only when the head is ≥ ${Math.round(t.timeRatio * 100)}% slower, ≥ ${t.minDeltaMs} ms slower, **and** slower in ≥ ${Math.round(t.consistency * 100)}% of the interleaved rounds.`,
    "- **Round trips** and **connections** regress on any increase; **bytes received** on growth over " +
      `${Math.round(t.bytesRatio * 100)}%. All three are deterministic for the fixed fixture catalog.`,
    `- Fewer than ${MIN_ROUNDS} completed rounds (e.g. a slowdown that ate the time budget) also fails.`,
    "- An intended slowdown: add the `perf-accepted` label; the verdict re-runs without re-measuring (on a fork PR, re-run the failed `Verdict` job by hand). The label never waives a scenario that errors on the head.",
    "- Reproduce locally: `cd packages/pg-delta && bun scripts/bench/run.ts --base <base checkout> && bun scripts/bench/compare.ts bench-results.json`.",
    "",
    "</details>",
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      markdown: { type: "string" },
      accepted: { type: "boolean", default: false },
      "base-ref": { type: "string", default: "base" },
      "head-ref": { type: "string", default: "head" },
    },
  });
  const results = (await Bun.file(
    positionals[0] ?? "bench-results.json",
  ).json()) as BenchResults;
  const comparisons = compare(results);
  const markdown = renderMarkdown(comparisons, {
    accepted: values.accepted,
    meta: results.meta,
    baseRef: values["base-ref"],
    headRef: values["head-ref"],
  });
  console.log(markdown);
  if (values.markdown !== undefined) await Bun.write(values.markdown, markdown);
  process.exit(gateFails(comparisons, values.accepted) ? 1 : 0);
}
