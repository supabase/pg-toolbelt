/**
 * Regression (#518): a table planned from an empty database, or exported and
 * reloaded, must keep its declared column order when a column is generated or
 * waits on a later dependency (a same-schema type, a function), except as noted
 * below.
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
 * A generated column that can run a user function and reads no column of its
 * own table can also land after the later columns that run no user function,
 * for the same reason (#554).
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

/** Plan `desiredSql` from an empty database (or from `sourceSql`), apply it,
 *  and return the planned table statements plus the declared and applied
 *  column orders. */
async function planFromEmpty(
  label: string,
  desiredSql: string,
  sourceSql?: string,
) {
  const source = await createTestDb(`colord_src_${label}`);
  const desired = await createTestDb(`colord_dst_${label}`);
  dbs.push(source, desired);
  if (sourceSql !== undefined) await source.pool.query(sourceSql);
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

  test("a generated column that reads no column is added after the later columns", async () => {
    // `g` reads no column of its table, so Postgres runs app.f() when `g` is
    // added, even on the empty table, and the body reads `b` with no pg_depend
    // edge to it. `g` stays an ADD COLUMN and lands last (#554).
    const result = await planFromEmpty(
      "genconst",
      `create schema app;
       create function app.f() returns int language plpgsql immutable
         as $$ begin return (select count(b) from app.orders); end $$;
       create table app.orders (
         id int,
         g int generated always as (app.f()) stored,
         b int
       );`,
    );
    expect(result.applied).toEqual(["id", "b", "g"]);
    expect(result.tableSql).toMatchInlineSnapshot(`
      [
        "CREATE TABLE "app"."orders" ("id" integer, "b" integer)",
        "ALTER TABLE "app"."orders" ADD COLUMN "g" integer GENERATED ALWAYS AS (app.f()) STORED",
      ]
    `);
  }, 60_000);

  test("the columns after a generated column that reads no column still follow the columns before it", async () => {
    // `b` and `c` no longer wait on `g`, but they still wait on `p`.
    const result = await planFromEmpty(
      "genconstkeep",
      `create schema app;
       create function app.k(int) returns int language sql immutable
         as $$ select $1 + 1 $$;
       create function app.one() returns int language sql immutable
         as $$ select 1 $$;
       create table app.orders (
         id int,
         p int generated always as (app.k(id)) stored,
         g int generated always as (app.one()) stored,
         b int,
         c int
       );`,
    );
    expect(result.applied).toEqual(["id", "p", "b", "c", "g"]);
  }, 60_000);

  test("a generated column reading an inherited column keeps its declared position", async () => {
    // Postgres records the read of `id` against the child's own column;
    // pg-delta's extractor resolves it to the parent's column plus an edge to
    // the child table itself.
    const result = await planFromEmpty(
      "geninh",
      `create schema app;
       create type app.mood as enum ('sad', 'ok');
       create function app.add_week(int) returns int language sql immutable
         as $$ select $1 + 7 $$;
       create table app.parent (id int);
       create table app.orders (
         g int generated always as (app.add_week(id)) stored,
         b app.mood
       ) inherits (app.parent);`,
    );
    expect(result.applied).toEqual(result.declared);
  }, 60_000);

  test("two generated columns whose expressions read no column fold into CREATE TABLE", async () => {
    // app.f() reads `b`. Inside CREATE TABLE, Postgres runs it after every
    // column exists. Adding `g` and then `b` one by one fails (#554).
    const fns = `create schema app;
       create function app.f() returns int language plpgsql immutable
         as $$ begin return (select count(b) from app.orders); end $$;
       create function app.one() returns int language sql immutable
         as $$ select 1 $$;`;
    const result = await planFromEmpty(
      "genconst2",
      `${fns}
       create table app.orders (
         id int,
         g int generated always as (app.f()) stored,
         b int generated always as (app.one()) stored
       );`,
      fns,
    );
    expect(result.tableSql).toMatchInlineSnapshot(`
      [
        "CREATE TABLE "app"."orders" ("id" integer, "g" integer GENERATED ALWAYS AS (app.f()) STORED, "b" integer GENERATED ALWAYS AS (app.one()) STORED)",
      ]
    `);
  }, 60_000);

  test("a generated column whose existing function reads no column folds before another table's DEFAULT reads it", async () => {
    // app.h() reads `g`, and Postgres runs it when `x` is added. `accounts`
    // sorts before `orders`, so `g` must fold into CREATE TABLE, not wait as
    // an ADD COLUMN behind `x`.
    const fns = `create schema app;
       create function app.one() returns int language sql immutable
         as $$ select 1 $$;
       create function app.h() returns int language plpgsql stable
         as $$ begin return (select coalesce(max(g), 0) from app.orders); end $$;
       create table app.accounts (id int);`;
    const result = await planFromEmpty(
      "genconstx",
      `${fns}
       create table app.orders (
         id int,
         g int generated always as (app.one()) stored,
         b int
       );
       alter table app.accounts add column x int default app.h();`,
      fns,
    );
    expect(result.tableSql).toMatchInlineSnapshot(`
      [
        "CREATE TABLE "app"."orders" ("id" integer, "b" integer, "g" integer GENERATED ALWAYS AS (app.one()) STORED)",
      ]
    `);
  }, 60_000);

  test("a generated column whose existing function reads no column still folds when a later column waits on a new type", async () => {
    // `b` waits on the enum, so it stays an ADD COLUMN. `g` must not wait
    // behind it, or `x` is added before `g` exists.
    const fns = `create schema app;
       create function app.one() returns int language sql immutable
         as $$ select 1 $$;
       create function app.h() returns int language plpgsql stable
         as $$ begin return (select coalesce(max(g), 0) from app.orders); end $$;
       create table app.accounts (id int);`;
    const result = await planFromEmpty(
      "genconsttype",
      `${fns}
       create type app.mood as enum ('a');
       create table app.orders (
         id int,
         g int generated always as (app.one()) stored,
         b app.mood
       );
       alter table app.accounts add column x int default app.h();`,
      fns,
    );
    expect(result.tableSql).toMatchInlineSnapshot(`
      [
        "CREATE TABLE "app"."orders" ("id" integer, "g" integer GENERATED ALWAYS AS (app.one()) STORED)",
        "ALTER TABLE "app"."orders" ADD COLUMN "b" app.mood",
      ]
    `);
  }, 60_000);

  test("a later generated column whose existing function reads a generated column that reads no column waits on it", async () => {
    // app.f2() reads `g`. `g` no longer leads, but `g2` still runs a user
    // function, so it must not fold into CREATE TABLE ahead of `g`.
    const fns = `create schema app;
       create function app.f2() returns int language plpgsql immutable
         as $$ begin return (select count(g) from app.orders); end $$;`;
    const result = await planFromEmpty(
      "genconstread",
      `${fns}
       create function app.f1() returns int language sql immutable
         as $$ select 1 $$;
       create table app.orders (
         id int,
         g int generated always as (app.f1()) stored,
         g2 int generated always as (app.f2()) stored
       );`,
      fns,
    );
    expect(result.applied).toEqual(result.declared);
  }, 60_000);

  test("a later evaluator column whose chain edge closes a cycle does not wait on a generated column that reads no column", async () => {
    // `l1` reads `e`, so `e` gets no chain edge and folds into CREATE TABLE,
    // where app.k() can read it when `x` is added. Waiting on `g`, whose
    // function the plan creates, would keep `e` an ADD COLUMN behind `x`.
    const fns = `create schema app;
       create function app.h() returns int language sql stable as $$ select 1 $$;
       create function app.k() returns int language plpgsql stable
         as $$ begin return (select count(e) from app.orders); end $$;
       create table app.accounts (id int);`;
    const result = await planFromEmpty(
      "genconstcycle",
      `${fns}
       create function app.f() returns int language plpgsql immutable
         as $$ begin return 1; end $$;
       create table app.orders (
         id int,
         g int generated always as (app.f()) stored,
         l1 int generated always as (e * 2) stored,
         e int default app.h()
       );
       alter table app.accounts add column x int default app.k();`,
      fns,
    );
    expect(result.tableSql[0]).toContain(`"e" integer DEFAULT app.h()`);
  }, 60_000);

  test("a generated column that reads no column is added before another table's DEFAULT that waits on a later column", async () => {
    // app.h() reads `b` (pg_depend) and app.read_g() reads `g` (no edge).
    // `x` waits on `b`, so `g` must still come before `x`.
    const fns = `create schema app;
       create table app.accounts (id int);
       insert into app.accounts values (1);
       create function app.read_g() returns int language plpgsql stable
         as $$ begin return (select count(g)::int from app.orders); end $$;`;
    await planFromEmpty(
      "genconstdown",
      `${fns}
       create function app.one() returns int language sql immutable
         as $$ select 1 $$;
       create table app.orders (
         id int,
         g int generated always as (app.one()) stored,
         b int
       );
       create function app.h() returns int language sql stable
         begin atomic select app.read_g() + (select count(b)::int from app.orders); end;
       alter table app.accounts add column x int default app.h();`,
      fns,
    );
  }, 60_000);

  test("a later DEFAULT column does not wait on a generated column that reads no column when a cycle already cut the chain", async () => {
    // app.f() reads `b`, so the chain edge from `g` to `b` is skipped and `e`
    // folds into CREATE TABLE, where app.k() can read it when `x` is added.
    const fns = `create schema app;
       create table app.accounts (id int);
       insert into app.accounts values (1);
       create function app.h() returns int language sql stable as $$ select 1 $$;
       create function app.k() returns int language plpgsql stable
         as $$ begin return (select count(e)::int from app.orders); end $$;`;
    const result = await planFromEmpty(
      "genconstcut",
      `${fns}
       create function app.f() returns int language sql immutable
         as $$ select 1 $$;
       create table app.orders (
         id int,
         g int generated always as (app.f()) stored,
         b int,
         e int default app.h()
       );
       create or replace function app.f() returns int language sql immutable
         begin atomic select count(b)::int from app.orders; end;
       alter table app.accounts add column x int default app.k();`,
      fns,
    );
    expect(result.tableSql[0]).toContain(`"e" integer DEFAULT app.h()`);
  }, 60_000);

  test("a later column does not wait on an earlier column when a cycle cut its chain edge from a generated column that reads no column", async () => {
    // app.f() reads `c`, so the chain edge from `g` to `c` is skipped and `c`
    // folds into CREATE TABLE, where app.k() can read it when `x` gets its
    // DEFAULT. `c` must not wait on `m` instead.
    const fns = `create schema app;
       create function app.k() returns int language plpgsql stable
         as $$ begin return (select count(c)::int from app.orders); end $$;
       create table app.accounts (id int);`;
    const result = await planFromEmpty(
      "genconstsplice",
      `${fns}
       alter table app.accounts add column x int;
       create function app.q(int) returns int language sql immutable
         begin atomic select $1 + count(x)::int from app.accounts; end;
       create function app.f() returns int language sql immutable
         begin atomic select 1; end;
       create table app.orders (
         id int,
         m int generated always as (app.q(id)) stored,
         g int generated always as (app.f()) stored,
         c int
       );
       create or replace function app.f() returns int language sql immutable
         begin atomic select count(c)::int from app.orders; end;
       alter table app.accounts alter column x set default app.k();`,
      fns,
    );
    expect(result.tableSql[0]).toContain(`"c" integer`);
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
