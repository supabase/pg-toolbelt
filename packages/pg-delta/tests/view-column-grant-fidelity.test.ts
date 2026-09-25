/**
 * Column-level grants on views and materialized views (`pg_attribute.attacl`
 * on relkind v/m) must be extracted and planned like table column grants.
 * View columns are not facts, so these grants hang off the view itself; a
 * view that is dropped and re-created must get its surviving column grants
 * back. supabase/cli#6761.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildFactBase, type FactBase } from "../src/core/fact.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const ROLE = "viewcolgrant_r";
const ROLE_SQL = `DO $$ BEGIN CREATE ROLE ${ROLE} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;

const SCHEMA_SQL = `
  CREATE SCHEMA private;
  CREATE SCHEMA api;
  CREATE TABLE private.items (
    id integer PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true
  );
  CREATE VIEW api.items WITH (security_invoker = true) AS
    SELECT id, name, is_active FROM private.items;
  CREATE MATERIALIZED VIEW api.item_names AS SELECT id, name FROM private.items;`;

const GRANTS_SQL = `
  GRANT INSERT (name) ON TABLE api.items TO ${ROLE};
  GRANT SELECT (name) ON api.item_names TO ${ROLE};`;

const dbs: TestDb[] = [];
const newDb = async (prefix: string, sql: string): Promise<TestDb> => {
  const db = await createTestDb(prefix);
  dbs.push(db);
  await db.pool.query(ROLE_SQL + sql);
  return db;
};

const planSql = (from: FactBase, to: FactBase): string[] =>
  plan(from, to).actions.map((a) => a.sql);

const applyAll = async (db: TestDb, sql: string[]): Promise<void> => {
  await db.pool.query(["BEGIN", ...sql, "COMMIT"].join(";\n"));
};

const columnAcls = async (db: TestDb, rel: string): Promise<string[]> => {
  const { rows } = await db.pool.query(
    `SELECT attname || ':' || attacl::text AS acl FROM pg_attribute
     WHERE attrelid = $1::regclass AND attnum > 0 AND attacl IS NOT NULL
     ORDER BY attname`,
    [rel],
  );
  return rows.map((r) => String(r["acl"]).replace(/\/[^}]*/, ""));
};

afterAll(async () => {
  for (const db of dbs) await db.drop();
});

describe("view column grants: from-empty export", () => {
  let sql: string[];
  let replay: TestDb;

  beforeAll(async () => {
    const src = await newDb("vcg-src", SCHEMA_SQL + GRANTS_SQL);
    const desired = (await extract(src.pool)).factBase;
    sql = planSql(buildFactBase([], []), desired);
    // Replay onto an empty database; planning from its own extract skips the
    // cluster-wide roles that already exist.
    replay = await newDb("vcg-replay", "");
    await applyAll(
      replay,
      planSql((await extract(replay.pool)).factBase, desired),
    );
  }, 120_000);

  test("emits the view column grant", () => {
    expect(sql).toContain(
      `GRANT INSERT ("name") ON TABLE "api"."items" TO "${ROLE}"`,
    );
  });

  test("emits the materialized view column grant", () => {
    expect(sql).toContain(
      `GRANT SELECT ("name") ON TABLE "api"."item_names" TO "${ROLE}"`,
    );
  });

  test("replaying the export restores both grants", async () => {
    expect(await columnAcls(replay, "api.items")).toEqual([`name:{${ROLE}=a}`]);
    expect(await columnAcls(replay, "api.item_names")).toEqual([
      `name:{${ROLE}=r}`,
    ]);
  });
});

describe("view column grants: diff", () => {
  test("a grant-only difference plans the GRANT and the REVOKE", async () => {
    const without = await newDb("vcg-a", SCHEMA_SQL);
    const withGrants = await newDb("vcg-b", SCHEMA_SQL + GRANTS_SQL);
    const a = (await extract(without.pool)).factBase;
    const b = (await extract(withGrants.pool)).factBase;
    expect(planSql(a, b)).toContain(
      `GRANT INSERT ("name") ON TABLE "api"."items" TO "${ROLE}"`,
    );
    expect(planSql(b, a)).toContain(
      `REVOKE ALL ("name") ON TABLE "api"."items" FROM "${ROLE}"`,
    );
  }, 120_000);

  test("re-creating a view keeps surviving column grants and drops removed ones", async () => {
    const base = `
      CREATE SCHEMA app;
      CREATE TABLE app.t (a int, b int);`;
    const src = await newDb(
      "vcg-rc-a",
      base +
        `CREATE VIEW app.v AS SELECT a, b FROM app.t;
         GRANT SELECT (a), SELECT (b) ON app.v TO ${ROLE};`,
    );
    const dst = await newDb(
      "vcg-rc-b",
      base +
        `CREATE VIEW app.v AS SELECT a FROM app.t;
         GRANT SELECT (a) ON app.v TO ${ROLE};`,
    );
    const sql = planSql(
      (await extract(src.pool)).factBase,
      (await extract(dst.pool)).factBase,
    );
    expect(sql.some((s) => s.includes(`("b")`))).toBe(false);
    await applyAll(src, sql);
    expect(await columnAcls(src, "app.v")).toEqual([`a:{${ROLE}=r}`]);
  }, 120_000);
});
