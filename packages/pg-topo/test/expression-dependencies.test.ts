import { describe, expect, test } from "bun:test";
import {
  addExpressionDependencies,
  addRoutineBodyDependencies,
} from "../src/extract/expression-dependencies";
import { parseSqlContent } from "../src/ingest/parse";
import type { ObjectRef } from "../src/model/types";

describe("addExpressionDependencies", () => {
  test("extracts function dependency from select with schema-qualified call", async () => {
    const { statements } = await parseSqlContent(
      "select app.my_func(1);",
      "test.sql",
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const ast = stmt?.ast;
    // @ts-expect-error - ast is a unknown type we don't care about it for testing
    const query = ast?.SelectStmt?.query ?? ast?.SelectStmt;
    const requires: ObjectRef[] = [];
    addExpressionDependencies(query ?? ast, requires);
    const funcRef = requires.find((r) => r.kind === "function");
    expect(funcRef).toBeDefined();
    expect(funcRef?.schema).toBe("app");
    expect(funcRef?.name).toBe("my_func");
  });

  test("processes cast expression without throwing", async () => {
    const { statements } = await parseSqlContent(
      "select 1::app.user_role;",
      "test.sql",
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const ast = stmt?.ast;
    // @ts-expect-error - ast is a unknown type we don't care about it for testing
    const query = ast?.SelectStmt?.query ?? ast?.SelectStmt;
    const requires: ObjectRef[] = [];
    addExpressionDependencies(query ?? ast, requires);
    expect(Array.isArray(requires)).toBe(true);
  });

  test("extracts table dependency from qualified table ref in expression", async () => {
    const { statements } = await parseSqlContent(
      "select * from app.users;",
      "test.sql",
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const ast = stmt?.ast;
    // @ts-expect-error - ast is a unknown type we don't care about it for testing
    const query = ast?.SelectStmt?.query ?? ast?.SelectStmt;
    const requires: ObjectRef[] = [];
    addExpressionDependencies(query ?? ast, requires);
    const tableRef = requires.find((r) => r.kind === "table");
    expect(tableRef).toBeDefined();
    expect(tableRef?.schema).toBe("app");
    expect(tableRef?.name).toBe("users");
  });
});

describe("addRoutineBodyDependencies", () => {
  test("no-op for non-SQL/plpgsql language", async () => {
    const { statements } = await parseSqlContent(
      "create function public.f() returns int language c as 'symbol';",
      "test.sql",
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const ast = stmt?.ast;
    // @ts-expect-error - ast is a unknown type we don't care about it for testing
    const createFn = ast?.CreateFunctionStmt;
    const requires: ObjectRef[] = [];
    addRoutineBodyDependencies(createFn ?? {}, requires);
    expect(requires).toHaveLength(0);
  });

  test("extracts dependencies from SQL function body", async () => {
    const { statements } = await parseSqlContent(
      "create function public.f() returns int language sql as $$ select 1 from app.t $$;",
      "test.sql",
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const ast = stmt?.ast;
    // @ts-expect-error - ast is a unknown type we don't care about it for testing
    const createFn = ast?.CreateFunctionStmt;
    const requires: ObjectRef[] = [];
    addRoutineBodyDependencies(createFn ?? {}, requires);
    const tableRef = requires.find((r) => r.kind === "table");
    expect(tableRef).toBeDefined();
    expect(tableRef?.name).toBe("t");
  });
});
