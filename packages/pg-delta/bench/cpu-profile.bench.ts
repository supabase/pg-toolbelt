/**
 * Long-run `sortChanges` loops for CPU profiling (no mitata — avoids JIT noise).
 *
 * Run: `cd packages/pg-delta && bun run bench:profile`
 * Output: markdown under `bench/profiles/` (gitignored).
 */

import { diffCatalogs } from "../src/core/catalog.diff.ts";
import { createEmptyCatalog } from "../src/core/catalog.model.ts";
import { sortChanges } from "../src/core/sort/sort-changes.ts";
import {
  type BenchScenario,
  buildSyntheticBranchCatalog,
} from "./synthetic-catalogs.ts";

const PROFILE_MS = 2500;
const SCENARIO_N: Record<BenchScenario, number> = {
  linearChain: 10_000,
  star: 10_000,
  dense: 10_000,
  supabaseShaped: 9000,
};

function burnSort(
  fn: () => void,
  durationMs: number,
): { iterations: number; elapsedMs: number } {
  const t0 = performance.now();
  let iterations = 0;
  while (performance.now() - t0 < durationMs) {
    fn();
    iterations++;
  }
  return { iterations, elapsedMs: performance.now() - t0 };
}

const mainCatalog = await createEmptyCatalog(170_000, "postgres");

for (const scenario of Object.keys(SCENARIO_N) as BenchScenario[]) {
  const n = SCENARIO_N[scenario];
  const branchCatalog = buildSyntheticBranchCatalog(mainCatalog, scenario, n);
  const changes = diffCatalogs(mainCatalog, branchCatalog, {});
  const ctx = { mainCatalog, branchCatalog };

  // Warmup
  for (let i = 0; i < 3; i++) sortChanges(ctx, changes);

  const { iterations, elapsedMs } = burnSort(
    () => sortChanges(ctx, changes),
    PROFILE_MS,
  );

  console.error(
    `[cpu-profile] ${scenario} n=${n} changes=${changes.length} iters=${iterations} elapsedMs=${elapsedMs.toFixed(0)}`,
  );
}
