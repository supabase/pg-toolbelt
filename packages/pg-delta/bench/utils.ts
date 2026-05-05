/**
 * Markdown tables + scaling helpers for benchmark output (issue paste).
 */

/** log(t2/t1) / log(n2/n1) — 1 ≈ linear, 2 ≈ quadratic in N. */
export function scalingExponent(
  n1: number,
  t1Ns: number,
  n2: number,
  t2Ns: number,
): number {
  if (n1 <= 0 || n2 <= 0 || n1 === n2) return Number.NaN;
  if (t1Ns <= 0 || t2Ns <= 0) return Number.NaN;
  return Math.log(t2Ns / t1Ns) / Math.log(n2 / n1);
}

export function formatMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const esc = (c: string) => c.replace(/\|/g, "\\|");
  const line = (cells: readonly string[]) =>
    `| ${cells.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

export function nsToMs(ns: number): string {
  if (!Number.isFinite(ns)) return "—";
  return (ns / 1e6).toFixed(3);
}
