import { performance } from "node:perf_hooks";
import { extractCatalog } from "../src/core/catalog.model.ts";
import { createPool, endPool } from "../src/core/postgres-config.ts";
import { POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG } from "../tests/constants.ts";
import { PostgresAlpineContainer } from "../tests/postgres-alpine.ts";

const POSTGRES_VERSION = 17;
const CONNECTION_COUNTS = [1, 2, 4] as const;
const ITERATIONS = Number(process.env.PGDELTA_BENCH_ITERATIONS ?? 3);

type ProfileName = "postgres" | "pglite";

type BenchResult = {
  connectionCount: number;
  postgresMs: number;
  pgliteMs: number;
  speedup: number;
};

async function main() {
  const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[POSTGRES_VERSION]}`;
  const container = await new PostgresAlpineContainer(image).start();

  try {
    console.log(
      `Starting catalog extraction benchmark (pg${POSTGRES_VERSION}, ${ITERATIONS} iteration(s) per profile)...`,
    );

    const seedPool = createPool(container.getConnectionUri(), {
      max: 1,
      connectionTimeoutMillis: 20_000,
      onError: suppressShutdownError,
    });

    try {
      await waitForPool(seedPool);
      await seedRepresentativeSchema(seedPool);
    } finally {
      await endPool(seedPool);
    }

    const results: BenchResult[] = [];

    for (const connectionCount of CONNECTION_COUNTS) {
      const postgresMs = await benchmarkProfile(
        container.getConnectionUri(),
        connectionCount,
        "postgres",
      );
      const pgliteMs = await benchmarkProfile(
        container.getConnectionUri(),
        connectionCount,
        "pglite",
      );

      results.push({
        connectionCount,
        postgresMs,
        pgliteMs,
        speedup: postgresMs / pgliteMs,
      });
    }

    printResults(results);
  } finally {
    await Promise.race([
      container.stop(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    process.exit(0);
  }
}

async function benchmarkProfile(
  connectionUri: string,
  connectionCount: number,
  profile: ProfileName,
): Promise<number> {
  const pool = createPool(connectionUri, {
    max: connectionCount,
    connectionTimeoutMillis: 20_000,
    onError: suppressShutdownError,
  });

  try {
    await waitForPool(pool);
    await extractCatalog(pool, { client: profile });

    let totalMs = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const startedAt = performance.now();
      await extractCatalog(pool, { client: profile });
      totalMs += performance.now() - startedAt;
    }

    return totalMs / ITERATIONS;
  } finally {
    await endPool(pool);
  }
}

async function seedRepresentativeSchema(pool: ReturnType<typeof createPool>) {
  const statements = [
    "DROP SCHEMA IF EXISTS catalog_bench CASCADE",
    "CREATE SCHEMA catalog_bench",
    "CREATE DOMAIN catalog_bench.email_address AS text CHECK (VALUE LIKE '%@%')",
    `CREATE OR REPLACE FUNCTION catalog_bench.audit_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$`,
    `CREATE OR REPLACE FUNCTION catalog_bench.log_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE NOTICE 'DDL event %', TG_TAG;
END;
$$`,
    `CREATE EVENT TRIGGER catalog_bench_ddl_logger
ON ddl_command_start
WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION catalog_bench.log_ddl()`,
  ];

  for (let i = 1; i <= 24; i++) {
    statements.push(
      `CREATE TABLE catalog_bench.items_${i} (
        id integer PRIMARY KEY,
        name text NOT NULL,
        email catalog_bench.email_address,
        created_at timestamptz DEFAULT now()
      )`,
      `CREATE INDEX items_${i}_name_idx ON catalog_bench.items_${i} (name)`,
      `CREATE VIEW catalog_bench.items_${i}_view AS
        SELECT id, name, created_at FROM catalog_bench.items_${i}`,
      `CREATE MATERIALIZED VIEW catalog_bench.items_${i}_mv AS
        SELECT id, name FROM catalog_bench.items_${i}`,
      `CREATE SEQUENCE catalog_bench.items_${i}_seq START 1 INCREMENT 1`,
      `CREATE TRIGGER items_${i}_audit_trigger
        BEFORE INSERT OR UPDATE ON catalog_bench.items_${i}
        FOR EACH ROW EXECUTE FUNCTION catalog_bench.audit_row()`,
    );
  }

  for (let i = 1; i <= 10; i++) {
    statements.push(`CREATE ROLE catalog_bench_role_${i}`);
  }

  statements.push(
    `CREATE PUBLICATION catalog_bench_pub
     FOR TABLE ${Array.from(
       { length: 8 },
       (_, index) => `catalog_bench.items_${index + 1}`,
     ).join(", ")}`,
  );

  await pool.query(statements.join(";\n"));
}

async function waitForPool(pool: ReturnType<typeof createPool>) {
  const client = await pool.connect();
  client.release();
}

function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") {
    return;
  }
  console.error("Pool error:", err);
}

function printResults(results: BenchResult[]) {
  console.log("");
  console.log("Average extraction time (ms)");
  console.log("");
  console.log("connections | postgres | pglite | speedup");
  console.log("----------- | -------- | ------- | -------");

  for (const result of results) {
    console.log(
      `${result.connectionCount.toString().padStart(11)} | ${result.postgresMs.toFixed(2).padStart(8)} | ${result.pgliteMs.toFixed(2).padStart(7)} | ${result.speedup.toFixed(2)}x`,
    );
  }

  const singleConnection = results.find(
    (result) => result.connectionCount === 1,
  );
  if (singleConnection) {
    console.log("");
    console.log(
      `Single-connection speedup: ${singleConnection.speedup.toFixed(2)}x (${singleConnection.postgresMs.toFixed(2)}ms -> ${singleConnection.pgliteMs.toFixed(2)}ms)`,
    );
  }
}

await main();
