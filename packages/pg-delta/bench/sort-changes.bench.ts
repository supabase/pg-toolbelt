/**
 * Synthetic sort benchmark: diff(empty baseline → synthetic branch), then time
 * `sortChanges` via mitata `measure`.
 *
 * Run: `cd packages/pg-delta && bun run bench`
 */

import { measure } from "mitata";
import { diffCatalogs } from "../src/core/catalog.diff.ts";
import { createEmptyCatalog } from "../src/core/catalog.model.ts";
import { sortChanges } from "../src/core/sort/sort-changes.ts";
import {
  type BenchScenario,
  buildSyntheticBranchCatalog,
} from "./synthetic-catalogs.ts";
import { formatMarkdownTable, nsToMs, scalingExponent } from "./utils.ts";

const SCENARIOS: BenchScenario[] = [
  "linearChain",
  "star",
  "dense",
  "supabaseShaped",
];

const N_VALUES = [10, 100, 500, 1000, 2500, 5000, 10_000] as const;

function scenarioMinN(s: BenchScenario): number {
  if (s === "star") return 1;
  return 2;
}

async function main() {
  const mainCatalog = await createEmptyCatalog(170_000, "postgres");

  for (const scenario of SCENARIOS) {
    console.log(`\n## ${scenario}\n`);
    const header = ["N", "changes", "p50_ms", "scale_vs_prev_N"];
    const rows: string[][] = [];
    let prevN = 0;
    let prevP50 = 0;

    for (const n of N_VALUES) {
      if (n < scenarioMinN(scenario)) continue;
      if (scenario === "dense" && n < 4) continue;

      const branchCatalog = buildSyntheticBranchCatalog(
        mainCatalog,
        scenario,
        n,
      );
      const changes = diffCatalogs(mainCatalog, branchCatalog, {});
      const ctx = { mainCatalog, branchCatalog };

      const stats = await measure(() => {
        sortChanges(ctx, changes);
      });

      const p50 = stats.p50;
      let scale = "—";
      if (prevN > 0 && prevP50 > 0) {
        const exp = scalingExponent(prevN, prevP50, n, p50);
        scale = Number.isFinite(exp) ? exp.toFixed(2) : "—";
      }
      prevN = n;
      prevP50 = p50;

      rows.push([String(n), String(changes.length), nsToMs(p50), scale]);
    }

    console.log(formatMarkdownTable(header, rows));
  }
}

await main();
