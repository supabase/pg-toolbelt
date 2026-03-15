import { describe, expect, test } from "bun:test";
import {
  addExpressionDependencies,
  addRoutineBodyDependencies,
} from "../src/extract/expression-dependencies.ts";
import { parseSqlContent } from "../src/ingest/parse.ts";
import type { ObjectRef } from "../src/model/types.ts";
import { runPgTopoEffect } from "./support/run-effect.ts";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const selectQueryNodeFromAst = (ast: unknown): unknown => {
  const selectStmt = asRecord(asRecord(ast)?.["SelectStmt"]);
  return selectStmt?.["query"] ?? selectStmt ?? ast;
};

const createFunctionNodeFromAst = (ast: unknown): Record<string, unknown> =>
  (asRecord(ast)?.["CreateFunctionStmt"] as Record<string, unknown> | undefined) ??
  ({} as Record<string, unknown>);

describe("addExpressionDependencies", () => {
  test("extracts function dependency from select with schema-qualified call", async () => {
    const { statements } = await runPgTopoEffect(
      parseSqlContent("select app.my_func(1);", "test.sql"),
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const requires: ObjectRef[] = [];
    addExpressionDependencies(selectQueryNodeFromAst(stmt?.ast), requires);
    const funcRef = requires.find((r) => r.kind === "function");
    expect(funcRef).toBeDefined();
    expect(funcRef?.schema).toBe("app");
    expect(funcRef?.name).toBe("my_func");
  });

  test("processes cast expression without throwing", async () => {
    const { statements } = await runPgTopoEffect(
      parseSqlContent("select 1::app.user_role;", "test.sql"),
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const requires: ObjectRef[] = [];
    addExpressionDependencies(selectQueryNodeFromAst(stmt?.ast), requires);
    expect(Array.isArray(requires)).toBe(true);
  });

  test("extracts table dependency from qualified table ref in expression", async () => {
    const { statements } = await runPgTopoEffect(
      parseSqlContent("select * from app.users;", "test.sql"),
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const requires: ObjectRef[] = [];
    addExpressionDependencies(selectQueryNodeFromAst(stmt?.ast), requires);
    const tableRef = requires.find((r) => r.kind === "table");
    expect(tableRef).toBeDefined();
    expect(tableRef?.schema).toBe("app");
    expect(tableRef?.name).toBe("users");
  });
});

describe("addRoutineBodyDependencies", () => {
  test("no-op for non-SQL/plpgsql language", async () => {
    const { statements } = await runPgTopoEffect(
      parseSqlContent(
        "create function public.f() returns int language c as 'symbol';",
        "test.sql",
      ),
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const requires: ObjectRef[] = [];
    addRoutineBodyDependencies(createFunctionNodeFromAst(stmt?.ast), requires);
    expect(requires).toHaveLength(0);
  });

  test("extracts dependencies from SQL function body", async () => {
    const { statements } = await runPgTopoEffect(
      parseSqlContent(
        "create function public.f() returns int language sql as $$ select 1 from app.t $$;",
        "test.sql",
      ),
    );
    const stmt = statements[0];
    expect(stmt).toBeDefined();
    const requires: ObjectRef[] = [];
    addRoutineBodyDependencies(createFunctionNodeFromAst(stmt?.ast), requires);
    const tableRef = requires.find((r) => r.kind === "table");
    expect(tableRef).toBeDefined();
    expect(tableRef?.name).toBe("t");
  });
});
