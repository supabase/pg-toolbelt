/**
 * A relation dropped AFTER the extraction snapshot was taken is still visible to
 * the snapshot's catalog scans, but the `pg_get_*def` deparsers read the latest
 * catalog: some then fail (`XX000 cache lookup failed …`), others return NULL.
 * Extraction must retry on a fresh snapshot rather than abort or record a NULL
 * definition, and fail with a typed error only when the churn never settles.
 *
 * The race is made deterministic by dropping the table from a side connection
 * immediately before the extractor sends the query that deparses it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import {
  ConcurrentCatalogChangeError,
  extract,
} from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const CONSTRAINTS_QUERY = (sql: string): boolean =>
  sql.includes("pg_get_constraintdef(con.oid)") &&
  sql.includes("con.conislocal");
const INDEXES_QUERY = (sql: string): boolean =>
  sql.includes("pg_get_indexdef(i.indexrelid)");
/** The coordinator's opening batch — the moment the snapshot is taken. */
const OPENING_BATCH = (sql: string): boolean =>
  sql.includes("BEGIN ISOLATION LEVEL REPEATABLE READ") &&
  !sql.includes("SET TRANSACTION SNAPSHOT");

type Hook = (sql: string) => Promise<void>;

/** Run `hook` before every catalog query any pooled client sends. */
function interceptQueries(pool: pg.Pool, hook: Hook): () => void {
  const patched = new Map<pg.PoolClient, unknown>();
  const onAcquire = (client: pg.PoolClient): void => {
    if (patched.has(client)) return;
    const realQuery = client.query.bind(client);
    patched.set(client, (client as { query: unknown }).query);
    // oxlint-disable-next-line no-explicit-any -- passthrough test double
    (client as any).query = async (...args: any[]) => {
      if (typeof args[0] === "string") await hook(args[0]);
      // oxlint-disable-next-line no-explicit-any -- passthrough test double
      return (realQuery as any)(...args);
    };
  };
  pool.on("acquire", onAcquire);
  return () => {
    pool.off("acquire", onAcquire);
    for (const [client, query] of patched) {
      (client as { query: unknown }).query = query;
    }
  };
}

let db: TestDb;
let side: pg.Client;

beforeAll(async () => {
  db = await createTestDb("concurrent-drop");
  await db.pool.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.keeper (id integer PRIMARY KEY, note text);
    CREATE INDEX keeper_note_idx ON app.keeper (note);
  `);
  side = new pg.Client({ connectionString: db.uri });
  await side.connect();
  // A lock held by the extraction would block the DROP forever; fail fast.
  await side.query("SET lock_timeout = '5s'");
}, 180_000);

afterAll(async () => {
  await side?.end();
  await db?.drop();
});

const tableNames = (facts: readonly { id: unknown }[]): string[] =>
  facts
    .map((f) => f.id as { kind: string; name?: string; table?: string })
    .filter((id) => id.kind === "table")
    .map((id) => id.name ?? "");

for (const concurrency of [1, 4]) {
  describe(`concurrency ${concurrency}`, () => {
    test("a table dropped mid-extraction (constraint deparse fails) is retried", async () => {
      const table = `victim_con_${concurrency}`;
      await side.query(`CREATE TABLE app.${table} (id integer PRIMARY KEY)`);
      let drops = 0;
      const restore = interceptQueries(db.pool, async (sql) => {
        if (drops === 0 && CONSTRAINTS_QUERY(sql)) {
          drops++;
          await side.query(`DROP TABLE app.${table}`);
        }
      });
      try {
        const { factBase } = await extract(db.pool, { concurrency });
        expect(drops).toBe(1);
        const names = tableNames(factBase.facts());
        expect(names).toContain("keeper");
        expect(names).not.toContain(table);
      } finally {
        restore();
      }
    }, 60_000);

    test("a table dropped mid-extraction (index deparse returns NULL) is retried", async () => {
      const table = `victim_idx_${concurrency}`;
      await side.query(
        `CREATE TABLE app.${table} (a integer); CREATE INDEX ${table}_a_idx ON app.${table} (a)`,
      );
      let drops = 0;
      const restore = interceptQueries(db.pool, async (sql) => {
        if (drops === 0 && INDEXES_QUERY(sql)) {
          drops++;
          await side.query(`DROP TABLE app.${table}`);
        }
      });
      try {
        const { factBase } = await extract(db.pool, { concurrency });
        expect(drops).toBe(1);
        const facts = factBase.facts();
        expect(tableNames(facts)).not.toContain(table);
        const nullDefs = facts.filter(
          (f) => (f.payload as { def?: unknown } | undefined)?.def === "null",
        );
        expect(nullDefs).toEqual([]);
      } finally {
        restore();
      }
    }, 60_000);

    test("churn that never settles fails with ConcurrentCatalogChangeError", async () => {
      const table = `victim_churn_${concurrency}`;
      const restore = interceptQueries(db.pool, async (sql) => {
        if (OPENING_BATCH(sql)) {
          await side.query(`CREATE TABLE app.${table} (id integer PRIMARY KEY)`);
        } else if (CONSTRAINTS_QUERY(sql)) {
          await side.query(`DROP TABLE app.${table}`);
        }
      });
      try {
        const error = await extract(db.pool, { concurrency }).catch(
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(ConcurrentCatalogChangeError);
        const typed = error as ConcurrentCatalogChangeError;
        expect(typed.code).toBe("concurrent_catalog_change");
        expect(typed.attempts).toBe(3);
        expect((typed.cause as { code?: string }).code).toBe("XX000");
      } finally {
        restore();
        await side.query(`DROP TABLE IF EXISTS app.${table}`);
      }
      // every attempt handed its clients back
      expect(db.pool.idleCount).toBe(db.pool.totalCount);
    }, 60_000);
  });
}
