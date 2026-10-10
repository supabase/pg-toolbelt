#!/usr/bin/env bun
/**
 * One side (PR head or base) of the CI benchmark gate, driven by ./run.ts.
 * Imports the pg-delta engine from the given package directory, builds the
 * scenario inputs and warms every scenario up once, then serves commands on
 * stdin: a scenario name runs one sample of it, `exit` ends the process.
 * Protocol lines on stdout start with {@link PROTOCOL_PREFIX}; anything else
 * there is engine noise.
 *
 *   bun scripts/bench/worker.ts <pg-delta package dir>
 *
 * Database URLs come from PGDELTA_BENCH_URLS (JSON, see {@link BenchUrls}).
 * Only the package's public entry point is used, so this file (always taken
 * from the head) can drive an older base checkout.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type pgTypes from "pg";

import {
  PROTOCOL_PREFIX,
  type BenchUrls,
  type ScenarioSample,
  type WorkerMessage,
} from "./protocol.ts";

type Engine = typeof import("../../src/index.ts");
type PgModule = typeof pgTypes;

function send(message: WorkerMessage): void {
  process.stdout.write(`${PROTOCOL_PREFIX}${JSON.stringify(message)}\n`);
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const pkgArg = process.argv[2];
if (pkgArg === undefined) {
  console.error("usage: worker.ts <pg-delta package dir>");
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
  /** Timed runs per sample; cheap scenarios take several to beat timer noise. */
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

async function setup(): Promise<Scenario[]> {
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
  // The Supabase CLI's declarative flow: Supabase profile, grouped layout.
  // Explicit owners because the fixture is owned by the container's login
  // role, not the profile's default owner `postgres`.
  const exportOptions = {
    profile: engine.supabaseProfile,
    scope: "database" as const,
    layout: "grouped" as const,
    defaultOwner: null,
  };
  const exported = await engine.buildSchemaExport(pools.large, exportOptions);

  let shadowSeq = 0;

  return [
    {
      name: "extract",
      iterations: 1,
      io: true,
      run: async () => ({
        body: () => raw.extract(pools.large, { redactSecrets: true }),
      }),
    },
    {
      name: "plan (small delta)",
      iterations: 5,
      io: false,
      run: async () => ({
        body: () => Promise.resolve(engine.plan(large, mutated, planOptions)),
      }),
    },
    {
      // The Supabase profile's policy projection dominates small-delta plans.
      name: "plan (small delta, supabase profile)",
      iterations: 3,
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
      iterations: 1,
      io: false,
      run: async () => ({
        body: () => Promise.resolve(engine.plan(empty, large, planOptions)),
      }),
    },
    {
      name: "declarative export (supabase profile)",
      iterations: 1,
      io: true,
      run: async () => ({
        body: () => engine.buildSchemaExport(pools.large, exportOptions),
      }),
    },
    {
      // `db schema declarative sync` on an unchanged export: load the files
      // into a fresh shadow, extract both sides, plan (expected: no changes).
      name: "declarative sync (no-op, supabase profile)",
      iterations: 1,
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
}

async function sample(scenario: Scenario): Promise<ScenarioSample> {
  const result: ScenarioSample = { ms: [] };
  if (scenario.io) {
    result.roundTrips = [];
    result.connections = [];
    result.bytes = [];
  }
  for (let i = 0; i < scenario.iterations; i++) {
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
    result.ms.push(ms);
    result.roundTrips?.push(io.roundTrips);
    result.connections?.push(io.connections);
    result.bytes?.push(io.bytes);
  }
  return result;
}

let scenarios: Scenario[];
try {
  const only = process.env["PGDELTA_BENCH_ONLY"];
  scenarios = (await setup()).filter(
    (s) => only === undefined || s.name.includes(only),
  );
} catch (error) {
  send({ setupError: errorMessage(error) });
  process.exit(0);
}

// One unrecorded run per scenario warms the JIT and per-pool caches; a
// scenario that cannot run reports its error on every command.
const broken = new Map<string, string>();
for (const scenario of scenarios) {
  try {
    await sample({ ...scenario, iterations: 1 });
  } catch (error) {
    broken.set(scenario.name, errorMessage(error));
  }
}
send({ ready: scenarios.map((s) => s.name) });

for await (const line of console) {
  const name = line.trim();
  if (name === "exit") break;
  const scenario = scenarios.find((s) => s.name === name);
  const error =
    broken.get(name) ?? (scenario === undefined ? "unknown scenario" : null);
  if (error !== null || scenario === undefined) {
    send({ scenario: name, result: { error: error ?? "unknown scenario" } });
    continue;
  }
  try {
    send({ scenario: name, result: await sample(scenario) });
  } catch (error) {
    send({ scenario: name, result: { error: errorMessage(error) } });
  }
}

await Promise.all(Object.values(pools).map((pool) => pool.end()));
process.exit(0);
