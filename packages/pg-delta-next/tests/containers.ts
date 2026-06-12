/**
 * Lean test-container manager: one PostgreSQL container per test process,
 * databases as the isolation unit (the proven model from the old suite).
 */
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import pg from "pg";

const PG_IMAGE = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";

let started: Promise<{
  container: StartedTestContainer;
  adminPool: pg.Pool;
  uriFor: (db: string) => string;
}> | null = null;

async function ensureContainer() {
  started ??= (async () => {
    const container = await new GenericContainer(PG_IMAGE)
      .withEnvironment({
        POSTGRES_USER: "test",
        POSTGRES_PASSWORD: "test",
        POSTGRES_DB: "postgres",
      })
      .withCommand([
        "postgres",
        "-c",
        "fsync=off",
        "-c",
        "full_page_writes=off",
        "-c",
        "max_connections=200",
      ])
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      )
      .start();
    const uriFor = (db: string) =>
      `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/${db}`;
    const adminPool = new pg.Pool({
      connectionString: uriFor("postgres"),
      max: 3,
    });
    return { container, adminPool, uriFor };
  })();
  return started;
}

let dbCounter = 0;

export interface TestDb {
  name: string;
  pool: pg.Pool;
  uri: string;
  /** Create a clone of this database via CREATE DATABASE … TEMPLATE. */
  clone(): Promise<TestDb>;
  drop(): Promise<void>;
}

async function makeDb(name: string): Promise<TestDb> {
  const { adminPool, uriFor } = await ensureContainer();
  const uri = uriFor(name);
  const pool = new pg.Pool({ connectionString: uri, max: 5 });
  pool.on("error", () => {});
  return {
    name,
    pool,
    uri,
    async clone() {
      // TEMPLATE requires zero connections on the source
      await pool.end().catch(() => {});
      const cloneName = `${name}_c${dbCounter++}`;
      await adminPool.query(
        `CREATE DATABASE "${cloneName}" TEMPLATE "${name}"`,
      );
      const fresh = await makeDb(cloneName);
      // reopen the source pool for continued use
      const reopened = new pg.Pool({ connectionString: uri, max: 5 });
      reopened.on("error", () => {});
      (this as { pool: pg.Pool }).pool = reopened;
      return fresh;
    },
    async drop() {
      await pool.end().catch(() => {});
      await adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

export async function createTestDb(prefix = "t"): Promise<TestDb> {
  const { adminPool } = await ensureContainer();
  const name = `${prefix}_${dbCounter++}`;
  await adminPool.query(`CREATE DATABASE "${name}"`);
  return makeDb(name);
}

/** Two databases for diff-style tests. */
export async function createDbPair(): Promise<{ a: TestDb; b: TestDb }> {
  const [a, b] = await Promise.all([createTestDb("a"), createTestDb("b")]);
  return { a, b };
}
