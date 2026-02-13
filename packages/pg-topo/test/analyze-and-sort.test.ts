import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";

describe("analyzeAndSort", () => {
  test("orders table before dependent view deterministically", async () => {
    const result = await analyzeAndSort([
      "create view public.user_emails as select email from public.users;",
      "create table public.users(id int primary key, email text not null);",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );

    expect(orderedClasses).toEqual(["CREATE_TABLE", "CREATE_VIEW"]);
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
      ),
    ).toHaveLength(0);
  });

  test("statically orders SQL functions by body dependencies", async () => {
    const result = await analyzeAndSort([
      "create function public.fn_a() returns int language sql as $$ select public.fn_b() $$;",
      "create function public.fn_b() returns int language sql as $$ select 1 $$;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(orderedSql[0]).toContain("fn_b");
    expect(orderedSql[1]).toContain("fn_a");
  });

  test("statically orders PLpgSQL functions by qualified body dependencies", async () => {
    const result = await analyzeAndSort([
      "create function public.fn_a() returns int language plpgsql as $$ begin return public.fn_b(); end; $$;",
      "create function public.fn_b() returns int language sql as $$ select 1 $$;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const hasUnknownClass = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    );

    expect(orderedSql[0]).toContain("fn_b");
    expect(orderedSql[1]).toContain("fn_a");
    expect(hasUnknownClass).toBe(false);
  });

  test("returns stable order across repeated runs", async () => {
    const sql = [
      "create schema app;",
      "create table app.accounts(id int primary key);",
      "create view app.account_ids as select id from app.accounts;",
    ];

    const first = await analyzeAndSort(sql);
    const second = await analyzeAndSort(sql);

    const firstIds = first.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );
    const secondIds = second.ordered.map(
      (statement) => `${statement.id.filePath}:${statement.id.statementIndex}`,
    );
    expect(firstIds).toEqual(secondIds);
  });
});
