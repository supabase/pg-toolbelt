#!/usr/bin/env bun
/**
 * One measurement process of the CI benchmark gate (driven by ./run.ts).
 * Imports the pg-delta engine from the given package directory — the PR head
 * or its base checkout — runs every scenario (one warmup, then timed
 * iterations) against the fixture databases prepared by run.ts, and writes
 * one JSON object to `<out>`.
 *
 *   bun scripts/bench/worker.ts <pg-delta package dir> <out.json>
 *
 * Database URLs come from PGDELTA_BENCH_URLS (JSON, see {@link BenchUrls}).
 * Only the package's public entry point is used, so this file (always taken
 * from the head) can drive an older base checkout.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type pgTypes from "pg";

type Engine = typeof import("../../src/index.ts");
type PgModule = typeof pgTypes;

export interface BenchUrls {
  admin: string;
  large: string;
  mutated: string;
  empty: string;
}

export interface ScenarioSample {
  ms: number[];
  /** Per timed iteration; present only for scenarios that talk to Postgres. */
  roundTrips?: number[];
  /** New connections; each costs several round trips (startup + auth). */
  connections?: number[];
  bytes?: number[];
}

export type WorkerOutput = Record<string, ScenarioSample | { error: string }>;

const [pkgArg, outArg] = process.argv.slice(2);
if (pkgArg === undefined || outArg === undefined) {
  console.error("usage: worker.ts <pg-delta package dir> <out.json>");
  process.exit(2);
}
const pkgDir = resolve(pkgArg);
const urls = JSON.parse(process.env["PGDELTA_BENCH_URLS"] ?? "") as BenchUrls;

const engine = (await import(join(pkgDir, "src/index.ts"))) as Engine;
// The side's own `pg`, so a driver bump in the PR is measured too.
const pg = createRequire(join(pkgDir, "package.json"))("pg") as PgModule;

interface Io {
  roundTrips: number;
  connections: number;
  bytes: number;
}

/** Count Postgres round trips, new connections, and bytes received while
 *  `fn` runs, by wrapping `Client.prototype.query`/`connect` (every pool and
 *  client call funnels through them). */
async function withIo(fn: () => Promise<unknown>): Promise<Io> {
  const proto = pg.Client.prototype as unknown as {
    query: (...args: unknown[]) => unknown;
    connect: (...args: unknown[]) => unknown;
  };
  const original = proto.query;
  const originalConnect = proto.connect;
  const readAtStart = new Map<object, number>();
  let roundTrips = 0;
  let connections = 0;
  const bytesRead = (client: object): number =>
    (client as { connection?: { stream?: { bytesRead?: number } } }).connection
      ?.stream?.bytesRead ?? 0;
  proto.query = function (this: object, ...args: unknown[]) {
    roundTrips++;
    if (!readAtStart.has(this)) readAtStart.set(this, bytesRead(this));
    return original.apply(this, args);
  };
  proto.connect = function (this: object, ...args: unknown[]) {
    connections++;
    return originalConnect.apply(this, args);
  };
  try {
    await fn();
    let bytes = 0;
    for (const [client, start] of readAtStart)
      bytes += bytesRead(client) - start;
    return { roundTrips, connections, bytes };
  } finally {
    proto.query = original;
    proto.connect = originalConnect;
  }
}

function newPool(url: string): pgTypes.Pool {
  // No idle reaping: a reconnect mid-run would make `connections` timing-dependent.
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 0,
  });
  pool.on("error", () => {});
  return pool;
}

interface Scenario {
  name: string;
  iterations: number;
  /** Count Postgres I/O (scenarios that reach Postgres). */
  io: boolean;
  /** Per-iteration setup, kept out of the timing like `cleanup`. */
  run: () => Promise<{
    body: () => Promise<unknown>;
    cleanup?: () => Promise<void>;
  }>;
}

const pools = {
  admin: newPool(urls.admin),
  large: newPool(urls.large),
  mutated: newPool(urls.mutated),
  empty: newPool(urls.empty),
};

const raw = await engine.resolveProfile(pools.large, engine.rawProfile, {
  redactSecrets: true,
});
// What the CLI passes on top of the resolved profile.
const cliPlanOptions = {
  renames: "off" as const,
  compact: true,
  redactSecrets: true,
};
const planOptions = { ...cliPlanOptions, ...raw.planOptions };
const extractRaw = async (pool: pgTypes.Pool) =>
  (await raw.extract(pool, { redactSecrets: true })).factBase;
const [large, mutated, empty] = await Promise.all([
  extractRaw(pools.large),
  extractRaw(pools.mutated),
  extractRaw(pools.empty),
]);
const supabaseCtx = await engine.resolveProfile(
  pools.large,
  engine.supabaseProfile,
  { redactSecrets: true },
);
const supabase = {
  planOptions: { ...cliPlanOptions, ...supabaseCtx.planOptions },
  large: (await supabaseCtx.extract(pools.large, { redactSecrets: true }))
    .factBase,
  mutated: (await supabaseCtx.extract(pools.mutated, { redactSecrets: true }))
    .factBase,
};
const exportOptions = {
  profile: engine.rawProfile,
  scope: "database" as const,
  layout: "grouped" as const,
};
const exported = await engine.buildSchemaExport(pools.large, exportOptions);

let shadowSeq = 0;

const scenarios: Scenario[] = [
  {
    name: "extract",
    iterations: 3,
    io: true,
    run: async () => ({
      body: () => raw.extract(pools.large, { redactSecrets: true }),
    }),
  },
  {
    name: "plan (small delta)",
    iterations: 7,
    io: false,
    run: async () => ({
      body: () => Promise.resolve(engine.plan(large, mutated, planOptions)),
    }),
  },
  {
    // The Supabase profile's policy projection dominates small-delta plans.
    name: "plan (small delta, supabase profile)",
    iterations: 7,
    io: false,
    run: async () => ({
      body: () =>
        Promise.resolve(
          engine.plan(supabase.large, supabase.mutated, supabase.planOptions),
        ),
    }),
  },
  {
    name: "plan (empty → large)",
    iterations: 3,
    io: false,
    run: async () => ({
      body: () => Promise.resolve(engine.plan(empty, large, planOptions)),
    }),
  },
  {
    name: "declarative export",
    iterations: 3,
    io: true,
    run: async () => ({
      body: () => engine.buildSchemaExport(pools.large, exportOptions),
    }),
  },
  {
    // `db schema declarative sync` on an unchanged export: load the files
    // into a fresh shadow, extract both sides, plan (expected: no changes).
    name: "declarative sync (no-op)",
    iterations: 2,
    io: true,
    run: async () => {
      const name = `bench_shadow_${process.pid}_${shadowSeq++}`;
      await pools.admin.query(`CREATE DATABASE "${name}"`);
      const url = new URL(urls.admin);
      url.pathname = `/${name}`;
      const shadow = newPool(url.toString());
      return {
        body: () =>
          engine.planSchemaFiles(pools.large, shadow, exported.files, {
            ...exportOptions,
            manifest: exported.manifest,
          }),
        cleanup: async () => {
          await shadow.end();
          await pools.admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        },
      };
    },
  },
];

const only = process.env["PGDELTA_BENCH_ONLY"];
const output: WorkerOutput = {};
for (const scenario of scenarios) {
  if (only !== undefined && !scenario.name.includes(only)) continue;
  const sample: ScenarioSample = { ms: [] };
  if (scenario.io) {
    sample.roundTrips = [];
    sample.connections = [];
    sample.bytes = [];
  }
  try {
    for (let i = 0; i <= scenario.iterations; i++) {
      const { body, cleanup } = await scenario.run();
      Bun.gc(true);
      let ms: number;
      let io: Io;
      try {
        const start = performance.now();
        io = await withIo(body);
        ms = performance.now() - start;
      } finally {
        await cleanup?.();
      }
      // Iteration 0 warms the JIT and per-pool caches; it is not recorded.
      if (i === 0) continue;
      sample.ms.push(ms);
      sample.roundTrips?.push(io.roundTrips);
      sample.connections?.push(io.connections);
      sample.bytes?.push(io.bytes);
    }
    output[scenario.name] = sample;
  } catch (error) {
    output[scenario.name] = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

await Bun.write(outArg, JSON.stringify(output));
await Promise.all(Object.values(pools).map((pool) => pool.end()));
process.exit(0);
