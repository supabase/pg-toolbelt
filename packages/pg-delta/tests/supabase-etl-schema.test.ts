/**
 * The `etl` schema belongs to Supabase ETL only when ETL created it: the image
 * ships the `supabase_etl_admin` role but no schema, and ETL runs
 * `create schema if not exists etl` when a pipeline starts. A user's own `etl`
 * schema must diff like any other (SUPABASE-API-BBR: an FK into a user
 * `etl.load_batch_sales` threw "missing requirement"), while ETL's objects stay
 * hidden by the owner rule. A user table inside an ETL-owned `etl` schema
 * cannot be planned (its schema is hidden), so the plan warns instead of
 * dropping it silently.
 *
 * Self-gated via runSupabaseBareTests.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import {
  runSupabaseBareTests,
  supabaseCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

async function makeDb(prefix: string, sql?: string): Promise<TestDb> {
  const cluster = await supabaseCluster();
  const db = await cluster.createDb(prefix);
  dbs.push(db);
  if (sql !== undefined) await db.pool.query(sql);
  return db;
}

const grantCreate = (role: string) => `
  DO $$ BEGIN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO ${role}', current_database());
  END $$;
`;

const USER_ETL = `
  ${grantCreate("postgres")}
  SET ROLE postgres;
  CREATE SCHEMA etl;
  CREATE SCHEMA raw;
  CREATE TABLE etl.load_batch_sales (batch_id bigint PRIMARY KEY);
  CREATE TABLE raw.sales (
    id bigint PRIMARY KEY,
    batch_id bigint REFERENCES etl.load_batch_sales (batch_id)
  );
  RESET ROLE;
`;

const PRODUCT_ETL = `
  ${grantCreate("supabase_etl_admin")}
  SET ROLE supabase_etl_admin;
  CREATE SCHEMA etl;
  CREATE TYPE etl.table_state AS ENUM ('init', 'ready');
  CREATE TABLE etl.replication_state (
    id bigserial PRIMARY KEY,
    state etl.table_state
  );
  RESET ROLE;
`;

const USER_TABLE_IN_PRODUCT_ETL = `
  ${PRODUCT_ETL}
  GRANT USAGE, CREATE ON SCHEMA etl TO postgres;
  SET ROLE postgres;
  CREATE TABLE etl.user_batches (batch_id bigint PRIMARY KEY);
  RESET ROLE;
`;

async function planBetween(source: TestDb, desired: TestDb) {
  const [s, d] = await Promise.all([
    extract(source.pool),
    extract(desired.pool),
  ]);
  return plan(s.factBase, d.factBase, { policy: supabasePolicy });
}

describe.skipIf(!runSupabaseBareTests)("supabase profile: etl schema", () => {
  test("a user-owned etl schema diffs like any other", async () => {
    const empty = await makeDb("etl_empty");
    const user = await makeDb("etl_user", USER_ETL);

    const forward = await planBetween(empty, user);
    expect(forward.actions.map((a) => a.sql)).toMatchInlineSnapshot(`
      [
        "CREATE SCHEMA "etl"",
        "CREATE SCHEMA "raw"",
        "CREATE TABLE "etl"."load_batch_sales" ("batch_id" bigint NOT NULL, CONSTRAINT "load_batch_sales_pkey" PRIMARY KEY (batch_id))",
        "CREATE TABLE "raw"."sales" ("id" bigint NOT NULL, "batch_id" bigint, CONSTRAINT "sales_pkey" PRIMARY KEY (id))",
        "ALTER TABLE "raw"."sales" ADD CONSTRAINT "sales_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES etl.load_batch_sales(batch_id)",
      ]
    `);

    const reverse = await planBetween(user, empty);
    expect(reverse.actions.map((a) => a.sql)).toMatchInlineSnapshot(`
      [
        "ALTER TABLE "raw"."sales" DROP CONSTRAINT "sales_batch_id_fkey"",
        "DROP TABLE "etl"."load_batch_sales"",
        "DROP TABLE "raw"."sales"",
        "DROP SCHEMA "etl"",
        "DROP SCHEMA "raw"",
      ]
    `);
  });

  test("Supabase ETL's own objects stay hidden", async () => {
    const empty = await makeDb("etl_empty2");
    const product = await makeDb("etl_product", PRODUCT_ETL);
    const p = await planBetween(empty, product);
    expect(p.actions).toEqual([]);
    expect(p.diagnostics ?? []).toEqual([]);
  });

  test("a user table inside the ETL-owned schema warns instead of vanishing", async () => {
    const empty = await makeDb("etl_empty3");
    const mixed = await makeDb("etl_mixed", USER_TABLE_IN_PRODUCT_ETL);
    const p = await planBetween(empty, mixed);
    expect(p.actions).toEqual([]);
    expect(p.diagnostics).toMatchInlineSnapshot(`
      [
        {
          "code": "hidden-by-excluded-parent",
          "context": {
            "parent": "schema:etl",
          },
          "message": "table:etl.user_batches is not managed: its parent schema:etl is excluded by the policy, so the plan neither creates nor drops it",
          "severity": "warning",
          "subject": {
            "kind": "table",
            "name": "user_batches",
            "schema": "etl",
          },
        },
      ]
    `);
  });
});
