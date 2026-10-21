/**
 * Regression (#518): a table planned from an empty database, or exported and
 * reloaded, must keep its declared column order when a column is generated or
 * waits on a later dependency (a same-schema type, a function).
 *
 * Column order is invisible to the proof loop (`_position` is non-semantic, so
 * the hashes match either way), so these tests apply the plan and read the real
 * order back from `pg_attribute`.
 *
 * Before the fix:
 *  - a generated column never got a fold hint, so the columns after it folded
 *    into `CREATE TABLE` and the generated column was appended last;
 *  - a column waiting on a function (rule weight 8) let the ready columns after
 *    it (weight 5) sort ahead of it, even with compaction disabled.
 *
 * A column whose DEFAULT calls a user function still lands after the columns
 * declared behind it: Postgres runs that function at ADD COLUMN time, and it may
 * read a later column that pg_depend does not record.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

async function columnOrder(db: TestDb, table: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ attname: string }>(
    `SELECT attname FROM pg_attribute
     WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
     ORDER BY attnum`,
    [table],
  );
  return rows.map((r) => r.attname);
}

/** Plan `desiredSql` from an empty database, apply it, and return the planned
 *  table statements plus the declared and applied column orders. */
async function planFromEmpty(label: string, desiredSql: string) {
  const source = await createTestDb(`colord_src_${label}`);
  const desired = await createTestDb(`colord_dst_${label}`);
  dbs.push(source, desired);
  await desired.pool.query(desiredSql);
  const [sourceState, desiredState] = [
    await extract(source.pool),
    await extract(desired.pool),
  ];
  const thePlan = plan(sourceState.factBase, desiredState.factBase);
  const report = await apply(thePlan, source.pool, { fingerprintGate: false });
  expect({ status: report.status, error: report.error?.message }).toEqual({
    status: "applied",
    error: undefined,
  });
  const tableSql = thePlan.actions
    .map((a) => a.sql)
    .filter((sql) => sql.includes(`"app"."orders"`) && !/ OWNER TO /.test(sql));
  return {
    tableSql,
    declared: await columnOrder(desired, "app.orders"),
    applied: await columnOrder(source, "app.orders"),
  };
}

describe("column order of a table planned from empty (#518)", () => {
  test("a DEFAULT whose function reads a later column still applies", async () => {
    // Postgres evaluates a non-volatile DEFAULT at ADD COLUMN time, even on an
    // empty table, so `a` needs `b` to exist. The plpgsql body records no
    // pg_depend edge to `b`, so only the evaluator ordering keeps `a` after
    // `b`; the position chain must not override it. `a` lands last.
    const result = await planFromEmpty(
      "deffn",
      `create schema app;
       create function app.f() returns int language plpgsql stable
         as $$ begin return (select count(b) from app.orders); end $$;
       create table app.orders (id int, a int default app.f(), b int);`,
    );
    expect(result.applied).toEqual(["id", "b", "a"]);
  }, 60_000);

  test("a column waiting on a function keeps its declared position", async () => {
    const result = await planFromEmpty(
      "genfn",
      `create schema app;
       create function app.add_week(date) returns date language sql immutable
         as $$ select $1 + 7 $$;
       create table app.orders (
         id int,
         placed_on date,
         ship_by date generated always as (app.add_week(placed_on)) stored,
         note text
       );`,
    );
    expect(result.applied).toEqual(result.declared);
    expect(result.tableSql).toMatchInlineSnapshot(`
      [
        "CREATE TABLE "app"."orders" ("id" integer, "placed_on" date)",
        "ALTER TABLE "app"."orders" ADD COLUMN "ship_by" date GENERATED ALWAYS AS (app.add_week(placed_on)) STORED",
        "ALTER TABLE "app"."orders" ADD COLUMN "note" text",
      ]
    `);
  }, 60_000);

  test("a generated column declared before the column it reads still plans", async () => {
    // Postgres accepts the forward reference in CREATE TABLE, but pg-delta adds
    // each column in its own step, so `placed_on` must come first. Chaining the
    // columns by position would form a cycle here; the plan must not throw.
    const result = await planFromEmpty(
      "genfwd",
      `create schema app;
       create table app.orders (
         id int,
         ship_by date generated always as (placed_on + 7) stored,
         placed_on date,
         note text
       );`,
    );
    expect(result.applied).toEqual(["id", "placed_on", "ship_by", "note"]);
  }, 60_000);
});

describe("column order after export and reload (#518)", () => {
  test("columns after a deferred column keep their declared position", async () => {
    const source = await createTestDb("colord_exp_src");
    const shadow = await createTestDb("colord_exp_shadow");
    dbs.push(source, shadow);
    await source.pool.query(`
      create schema app;
      create type app.mood as enum ('sad', 'ok');
      create table app.generated (id int, d date, p date generated always as (d) stored, note text);
      create table app.typed (id int, m app.mood, note text);
    `);
    const files = exportSqlFiles((await extract(source.pool)).factBase, {
      layout: "by-object",
    }).filter((f) => !/cluster[_/]roles/.test(f.name));
    await loadSqlFiles(files, shadow.pool);
    for (const table of ["app.generated", "app.typed"]) {
      expect({ table, columns: await columnOrder(shadow, table) }).toEqual({
        table,
        columns: await columnOrder(source, table),
      });
    }
  }, 60_000);

  test("a DEFAULT calling a function is added after the later columns", async () => {
    // A DEFAULT that calls a user function runs it at ADD COLUMN time, and the
    // function may read a later column with no pg_depend edge to it (`app.t`).
    // Such a column keeps the evaluator ordering, so it lands last: a known
    // limit of #518's fix.
    const source = await createTestDb("colord_expfn_src");
    const shadow = await createTestDb("colord_expfn_shadow");
    dbs.push(source, shadow);
    await source.pool.query(`
      create schema app;
      create function app.one() returns int language sql immutable
        as $$ select 1 $$;
      create function app.f() returns int language plpgsql stable
        as $$ begin return (select count(b) from app.t); end $$;
      create table app.fn_default (id int, x int default app.one(), note text);
      create table app.t (id int, a int default app.f(), b int);
    `);
    const files = exportSqlFiles((await extract(source.pool)).factBase, {
      layout: "by-object",
    }).filter((f) => !/cluster[_/]roles/.test(f.name));
    await loadSqlFiles(files, shadow.pool);
    expect(await columnOrder(shadow, "app.fn_default")).toEqual([
      "id",
      "note",
      "x",
    ]);
    expect(await columnOrder(shadow, "app.t")).toEqual(["id", "b", "a"]);
  }, 60_000);
});
