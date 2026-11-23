#!/usr/bin/env bun
/**
 * CI benchmark gate, measurement half: benchmark two checkouts of the repo on
 * the SAME machine against the SAME Postgres. A ./worker.ts per side does its
 * setup and warmup; then, round after round, every scenario is sampled on
 * both sides back to back, alternating which side goes first, so runner-speed
 * drift hits both equally. Rounds stop at `--rounds` or, past the first
 * MIN_ROUNDS, when the next step would overrun `--budget` seconds.
 * ./compare.ts turns the result into a verdict + report.
 *
 * Both workers are replaced every `--restart-every` rounds. One worker can run
 * a scenario a few percent faster or slower than its twin for its whole life,
 * whatever code it loaded (5% on the cheapest plan scenario, across CI runs),
 * so the rounds of one worker pair all lean the same way. A second pair draws
 * that luck again.
 *
 *   bun scripts/bench/run.ts --base <repo root> [--head <repo root>]
 *       [--rounds 10] [--restart-every 5] [--budget 180]
 *       [--out bench-results.json]
 *
 * `--head` defaults to this checkout. Point both at the same checkout for an
 * A/A run (measures the gate's false-positive rate). PGDELTA_TEST_IMAGE picks
 * the Postgres image; PGDELTA_BENCH_ONLY=<substring> limits the scenarios.
 */
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { sharedCluster } from "../../tests/containers.ts";
import { fixtureSql, MUTATIONS } from "./fixture.ts";
import {
  PROTOCOL_PREFIX,
  type BenchResults,
  type BenchUrls,
  type Side,
  type ScenarioSample,
  type WorkerMessage,
  type WorkerOutput,
} from "./protocol.ts";
import { nextStep } from "./schedule.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string" },
    rounds: { type: "string", default: "10" },
    "restart-every": { type: "string", default: "5" },
    budget: { type: "string", default: "180" },
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
const maxRounds = Number(values.rounds);
const restartEvery = Number(values["restart-every"]);
const budgetMs = Number(values.budget) * 1000;

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

async function* lines(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    for (let i = buffered.indexOf("\n"); i >= 0; i = buffered.indexOf("\n")) {
      yield buffered.slice(0, i);
      buffered = buffered.slice(i + 1);
    }
  }
  if (buffered !== "") yield buffered;
}

class Worker {
  readonly #proc;
  readonly #lines;
  alive = true;

  constructor(readonly side: Side) {
    this.#proc = Bun.spawn(
      ["bun", join(import.meta.dir, "worker.ts"), pkgOf(roots[side])],
      {
        env: { ...process.env, PGDELTA_BENCH_URLS: JSON.stringify(urls) },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      },
    );
    this.#lines = lines(this.#proc.stdout);
  }

  /** Next protocol message; `null` (and the worker marked dead) at exit. */
  async next(): Promise<WorkerMessage | null> {
    for (;;) {
      const { value, done } = await this.#lines.next();
      if (done === true) {
        this.alive = false;
        console.error(`bench: ${this.side} worker exited`);
        return null;
      }
      if (value.startsWith(PROTOCOL_PREFIX)) {
        return JSON.parse(value.slice(PROTOCOL_PREFIX.length)) as WorkerMessage;
      }
      console.error(`[${this.side}] ${value}`);
    }
  }

  async sample(scenario: string): Promise<ScenarioSample | { error: string }> {
    if (!this.alive) return { error: "worker process crashed" };
    await this.#proc.stdin.write(`${scenario}\n`);
    await this.#proc.stdin.flush();
    const message = await this.next();
    return message !== null && "result" in message
      ? message.result
      : { error: "worker process crashed" };
  }

  async close(): Promise<void> {
    if (this.alive) {
      await this.#proc.stdin.write("exit\n");
      await this.#proc.stdin.end();
    }
    await this.#proc.exited;
  }
}

/** Start a fresh worker per side and wait for their setup and warmup. */
async function startWorkers(): Promise<{
  workers: Record<Side, Worker>;
  scenarios: string[];
  ms: number;
}> {
  const started = performance.now();
  const workers = { base: new Worker("base"), head: new Worker("head") };
  const ready = await Promise.all(
    (["base", "head"] as const).map(async (side) => {
      const message = await workers[side].next();
      if (message !== null && "ready" in message) return message.ready;
      console.error(
        `bench: ${side} setup failed: ${message !== null && "setupError" in message ? message.setupError : "worker exited"}`,
      );
      workers[side].alive = false;
      return [];
    }),
  );
  const ms = performance.now() - started;
  console.error(`bench: workers ready in ${(ms / 1000).toFixed(1)}s`);
  return { workers, scenarios: [...new Set(ready.flat())], ms };
}

const first = await startWorkers();
let workers = first.workers;
const scenarios = first.scenarios;

const results: BenchResults = {
  meta: {
    rounds: 0,
    workerPairs: 1,
    pgImage: process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
    base: roots.base,
    head: roots.head,
  },
  rounds: [],
};
const sampling = performance.now();
let slowestRoundMs = 0;
let slowestRestartMs = first.ms;
for (let round = 0; round < maxRounds; round++) {
  const step = nextStep({
    round,
    restartEvery,
    elapsedMs: performance.now() - sampling,
    budgetMs,
    slowestRoundMs,
    slowestRestartMs,
  });
  if (step === "stop") {
    console.error(`bench: stopping after ${round} rounds (budget)`);
    break;
  }
  if (step === "restart") {
    await Promise.all([workers.base.close(), workers.head.close()]);
    const restarted = await startWorkers();
    workers = restarted.workers;
    slowestRestartMs = Math.max(slowestRestartMs, restarted.ms);
    results.meta.workerPairs = (results.meta.workerPairs ?? 1) + 1;
  }
  const roundStart = performance.now();
  const outputs: Record<Side, WorkerOutput | null> = { base: {}, head: {} };
  for (const [index, scenario] of scenarios.entries()) {
    const order: Side[] =
      (round + index) % 2 === 0 ? ["base", "head"] : ["head", "base"];
    for (const side of order) {
      outputs[side]![scenario] = await workers[side].sample(scenario);
    }
  }
  for (const side of ["base", "head"] as const) {
    if (!workers[side].alive) outputs[side] = null;
  }
  results.rounds.push(outputs);
  const roundMs = performance.now() - roundStart;
  slowestRoundMs = Math.max(slowestRoundMs, roundMs);
  console.error(
    `bench: round ${round + 1} done in ${(roundMs / 1000).toFixed(1)}s`,
  );
}
results.meta.rounds = results.rounds.length;

await Promise.all([workers.base.close(), workers.head.close()]);
await Bun.write(values.out, JSON.stringify(results, null, 2));
await Promise.all([large.drop(), mutated.drop(), empty.drop()]);
process.exit(0);
