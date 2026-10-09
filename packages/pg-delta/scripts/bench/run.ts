#!/usr/bin/env bun
/**
 * CI benchmark gate, measurement half: benchmark two checkouts of the repo on
 * the SAME machine against the SAME Postgres, interleaving them round by round
 * (base,head / head,base / …) so runner-speed drift hits both sides equally.
 * Each round spawns a fresh ./worker.ts process per side. ./compare.ts turns
 * the result into a verdict + report.
 *
 *   bun scripts/bench/run.ts --base <repo root> [--head <repo root>]
 *                            [--rounds 6] [--out bench-results.json]
 *
 * `--head` defaults to this checkout. Point both at the same checkout for an
 * A/A run (measures the gate's false-positive rate). PGDELTA_TEST_IMAGE picks
 * the Postgres image; PGDELTA_BENCH_ONLY=<substring> limits the scenarios.
 */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { sharedCluster } from "../../tests/containers.ts";
import { fixtureSql, MUTATIONS } from "./fixture.ts";
import type { BenchUrls, WorkerOutput } from "./worker.ts";

export type Side = "base" | "head";

export interface BenchResults {
  meta: {
    rounds: number;
    pgImage: string;
    base: string;
    head: string;
  };
  /** `rounds[i][side]`: one worker process; `null` when it crashed. */
  rounds: Record<Side, WorkerOutput | null>[];
}

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string" },
    rounds: { type: "string", default: "6" },
    out: { type: "string", default: "bench-results.json" },
  },
});
if (values.base === undefined) {
  console.error("usage: run.ts --base <repo root> [--head <repo root>]");
  process.exit(2);
}
const pkgOf = (root: string): string => resolve(root, "packages/pg-delta");
const roots: Record<Side, string> = {
  base: values.base,
  head: values.head ?? resolve(import.meta.dir, "../../../.."),
};
const roundCount = Number(values.rounds);

const cluster = await sharedCluster();
const [large, mutated, empty] = await Promise.all([
  cluster.createDb("bench_large"),
  cluster.createDb("bench_mutated"),
  cluster.createDb("bench_empty"),
]);
await large.pool.query(fixtureSql());
await mutated.pool.query(fixtureSql());
await mutated.pool.query(MUTATIONS);
// Fresh planner statistics so catalog query plans don't shift mid-run.
await Promise.all([large, mutated].map((db) => db.pool.query("ANALYZE")));

const urls: BenchUrls = {
  admin: cluster.uriFor("postgres"),
  large: large.uri,
  mutated: mutated.uri,
  empty: empty.uri,
};

async function runWorker(
  side: Side,
  round: number,
): Promise<WorkerOutput | null> {
  const out = join(
    process.env["RUNNER_TEMP"] ?? tmpdir(),
    `bench-${side}-${round}.json`,
  );
  const proc = Bun.spawn(
    ["bun", join(import.meta.dir, "worker.ts"), pkgOf(roots[side]), out],
    {
      env: { ...process.env, PGDELTA_BENCH_URLS: JSON.stringify(urls) },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await proc.exited) !== 0) {
    console.error(`bench: ${side} worker crashed in round ${round}`);
    return null;
  }
  return (await Bun.file(out).json()) as WorkerOutput;
}

const results: BenchResults = {
  meta: {
    rounds: roundCount,
    pgImage: process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
    base: roots.base,
    head: roots.head,
  },
  rounds: [],
};
for (let round = 0; round < roundCount; round++) {
  const order: Side[] = round % 2 === 0 ? ["base", "head"] : ["head", "base"];
  const outputs = { base: null, head: null } as Record<
    Side,
    WorkerOutput | null
  >;
  for (const side of order) {
    const started = performance.now();
    outputs[side] = await runWorker(side, round);
    console.error(
      `bench: round ${round + 1}/${roundCount} ${side} done in ${((performance.now() - started) / 1000).toFixed(1)}s`,
    );
  }
  results.rounds.push(outputs);
}

await Bun.write(values.out, JSON.stringify(results, null, 2));
await Promise.all([large.drop(), mutated.drop(), empty.drop()]);
process.exit(0);
