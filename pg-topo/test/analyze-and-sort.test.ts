import { afterAll, describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { createTempFixtureHarness } from "./support/temp-fixture";

const fixtures = createTempFixtureHarness("pg-topo-");
const createSqlFixture = fixtures.createSqlFixture;

afterAll(fixtures.cleanup);

describe("analyzeAndSort", () => {
  test("orders table before dependent view deterministically", async () => {
    const root = await createSqlFixture({
      "02_view.sql": "create view public.user_emails as select email from public.users;",
      "01_table.sql": "create table public.users(id int primary key, email text not null);",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const orderedClasses = result.ordered.map((statement) => statement.statementClass);

    expect(orderedClasses).toEqual(["CREATE_TABLE", "CREATE_VIEW"]);
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === "CYCLE_DETECTED"),
    ).toHaveLength(0);
  });

  test("statically orders SQL functions by body dependencies", async () => {
    const root = await createSqlFixture({
      "00_fn_a.sql":
        "create function public.fn_a() returns int language sql as $$ select public.fn_b() $$;",
      "01_fn_b.sql": "create function public.fn_b() returns int language sql as $$ select 1 $$;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const orderedPaths = result.ordered.map((statement) => statement.id.filePath);

    expect(orderedPaths[0]).toContain("01_fn_b.sql");
    expect(orderedPaths[1]).toContain("00_fn_a.sql");
  });

  test("statically orders PLpgSQL functions by qualified body dependencies", async () => {
    const root = await createSqlFixture({
      "00_fn_a.sql":
        "create function public.fn_a() returns int language plpgsql as $$ begin return public.fn_b(); end; $$;",
      "01_fn_b.sql": "create function public.fn_b() returns int language sql as $$ select 1 $$;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const orderedPaths = result.ordered.map((statement) => statement.id.filePath);
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedPaths[0]).toContain("01_fn_b.sql");
    expect(orderedPaths[1]).toContain("00_fn_a.sql");
    expect(hasUnknownClass).toBe(false);
  });

  test("returns stable order across repeated runs", async () => {
    const root = await createSqlFixture({
      "schema.sql": "create schema app;",
      "table.sql": "create table app.accounts(id int primary key);",
      "view.sql": "create view app.account_ids as select id from app.accounts;",
    });

    const first = await analyzeAndSort({ roots: [root] });
    const second = await analyzeAndSort({ roots: [root] });

    const firstIds = first.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );
    const secondIds = second.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );
    expect(firstIds).toEqual(secondIds);
  });
});
