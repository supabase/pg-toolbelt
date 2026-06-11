import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";

describe("range type dependencies", () => {
  test("orders executable range type dependencies", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, during app.int_range not null);",
      "create type app.int_range as range (subtype = int4, subtype_diff = app.int4_subdiff);",
      "create function app.int4_subdiff(a int4, b int4) returns float8 language sql immutable as $$ select (a - b)::float8 $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const subtypeDiffIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_subdiff"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(subtypeDiffIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in range support functions", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.floatrange not null);",
      "create type app.floatrange as range (subtype = float8, subtype_diff = float8mi);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.floatrange"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders range type after custom collation", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, value_span app.label_range not null);",
      "create type app.label_range as range (subtype = text, collation = app.default_ci);",
      'create collation app.default_ci from "C";',
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const collationIndex = orderedSql.findIndex((sql) =>
      sql.includes("create collation app.default_ci"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(collationIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(collationIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders range type after custom operator class", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after support functions", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 app.int4_range_cmp(int4, int4);",
      "create function app.int4_range_cmp(a int4, b int4) returns int4 language sql immutable strict as $$ select a - b $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_range_cmp"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(supportFunctionIndex).toBeGreaterThan(schemaIndex);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("targets btree operator classes when access methods share a class name", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.shared_int4_ops);",
      "create operator class app.shared_int4_ops for type int4 using hash as operator 1 = (int4, int4), function 1 hashint4(int4);",
      "create operator class app.shared_int4_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.custom_int4_range"),
    );

    expect(duplicateCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "shared_int4_ops",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const hashOperatorClassIndex = orderedSql.findIndex(
      (sql) =>
        sql.includes("create operator class app.shared_int4_ops") &&
        sql.includes("using hash"),
    );
    const btreeOperatorClassIndex = orderedSql.findIndex(
      (sql) =>
        sql.includes("create operator class app.shared_int4_ops") &&
        sql.includes("using btree"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(hashOperatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(btreeOperatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(btreeOperatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after conventional support operators for custom types", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const firstFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_lt"),
    );
    const lastFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_gt"),
    );
    const firstOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator <"),
    );
    const lastOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator >"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(typeIndex).toBeGreaterThan(schemaIndex);
    expect(firstFunctionIndex).toBeGreaterThan(typeIndex);
    expect(lastFunctionIndex).toBeGreaterThan(typeIndex);
    expect(firstOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(firstOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(operatorClassIndex).toBeGreaterThan(firstOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(lastOperatorIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after conventional support function names with custom types", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 btint4cmp(app.score, app.score);",
      "create function btint4cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function btint4cmp"),
    );
    const firstOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator <"),
    );
    const lastOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator >"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4cmp",
      signature: "(app.score,app.score)",
    });
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(supportFunctionIndex).toBeGreaterThan(typeIndex);
    expect(firstOperatorIndex).toBeGreaterThan(supportFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(supportFunctionIndex);
    expect(operatorClassIndex).toBeGreaterThan(firstOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(lastOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom operator classes after support operators", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 app.<# (int4, int4), operator 2 app.<=# (int4, int4), operator 3 app.=# (int4, int4), operator 4 app.>=# (int4, int4), operator 5 app.># (int4, int4), function 1 btint4cmp(int4, int4);",
      "create operator app.># (function = app.int4_gt, leftarg = int4, rightarg = int4);",
      "create operator app.>=# (function = app.int4_gte, leftarg = int4, rightarg = int4);",
      "create operator app.=# (function = app.int4_eq, leftarg = int4, rightarg = int4);",
      "create operator app.<=# (function = app.int4_lte, leftarg = int4, rightarg = int4);",
      "create operator app.<# (function = app.int4_lt, leftarg = int4, rightarg = int4);",
      "create function app.int4_gt(a int4, b int4) returns boolean language sql immutable strict as $$ select a > b $$;",
      "create function app.int4_gte(a int4, b int4) returns boolean language sql immutable strict as $$ select a >= b $$;",
      "create function app.int4_eq(a int4, b int4) returns boolean language sql immutable strict as $$ select a = b $$;",
      "create function app.int4_lte(a int4, b int4) returns boolean language sql immutable strict as $$ select a <= b $$;",
      "create function app.int4_lt(a int4, b int4) returns boolean language sql immutable strict as $$ select a < b $$;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const firstFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_lt"),
    );
    const lastFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int4_gt"),
    );
    const firstOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.<#"),
    );
    const lastOperatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.>#"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(firstFunctionIndex).toBeGreaterThan(schemaIndex);
    expect(lastFunctionIndex).toBeGreaterThan(schemaIndex);
    expect(firstOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(firstOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(firstFunctionIndex);
    expect(lastOperatorIndex).toBeGreaterThan(lastFunctionIndex);
    expect(operatorClassIndex).toBeGreaterThan(firstOperatorIndex);
    expect(operatorClassIndex).toBeGreaterThan(lastOperatorIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("records operator estimator functions as operator dependencies", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = app.score_sel, join = app.score_join);",
      "create function app.score_join(internal, oid, internal, smallint, internal) returns float8 language internal stable strict as 'eqjoinsel';",
      "create function app.score_sel(internal, oid, internal, integer) returns float8 language internal stable strict as 'eqsel';",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<#"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_sel",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const operatorFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_lt"),
    );
    const restrictFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_sel"),
    );
    const joinFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_join"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.<#"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(operatorFunctionIndex).toBeGreaterThan(typeIndex);
    expect(restrictFunctionIndex).toBeGreaterThan(typeIndex);
    expect(joinFunctionIndex).toBeGreaterThan(typeIndex);
    expect(operatorIndex).toBeGreaterThan(operatorFunctionIndex);
    expect(operatorIndex).toBeGreaterThan(restrictFunctionIndex);
    expect(operatorIndex).toBeGreaterThan(joinFunctionIndex);
  }, 120000);

  test("does not require producer statements for built-in operator estimators", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = eqsel, join = eqjoinsel);",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const typeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score as"),
    );
    const operatorFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.score_lt"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.<#"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(typeIndex).toBeGreaterThanOrEqual(0);
    expect(operatorFunctionIndex).toBeGreaterThan(typeIndex);
    expect(operatorIndex).toBeGreaterThan(operatorFunctionIndex);
  }, 120000);

  test("distinguishes prefix and postfix operator signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.! (function = app.score_postfix, leftarg = app.score);",
      "create operator app.! (function = app.score_prefix, rightarg = app.score);",
      "create function app.score_postfix(value app.score) returns boolean language sql immutable strict as $$ select (value).value > 0 $$;",
      "create function app.score_prefix(value app.score) returns boolean language sql immutable strict as $$ select (value).value = 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const postfixOperatorStatement = result.ordered.find(
      (statement) =>
        statement.sql.toLowerCase().startsWith("create operator app.!") &&
        statement.sql.toLowerCase().includes("score_postfix"),
    );
    const prefixOperatorStatement = result.ordered.find(
      (statement) =>
        statement.sql.toLowerCase().startsWith("create operator app.!") &&
        statement.sql.toLowerCase().includes("score_prefix"),
    );

    expect(duplicateCount).toBe(0);
    expect(postfixOperatorStatement?.provides).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "!",
      signature: "(app.score,none)",
    });
    expect(prefixOperatorStatement?.provides).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "!",
      signature: "(none,app.score)",
    });
  }, 120000);

  test("orders overloaded float8mi before non-float8 range subtypes", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops, subtype_diff = float8mi);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function float8mi(a app.score, b app.score) returns float8 language sql immutable strict as $$ select ((a).value - (b).value)::float8 $$;",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value float8);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "float8mi",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const subtypeDiffIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function float8mi"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(subtypeDiffIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("requires custom opclass functions when built-in names use different argument types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.uuid_range_ops for type uuid using btree as operator 1 < (uuid, uuid), operator 2 <= (uuid, uuid), operator 3 = (uuid, uuid), operator 4 >= (uuid, uuid), operator 5 > (uuid, uuid), function 1 btint4cmp(uuid, uuid);",
      "create function btint4cmp(a uuid, b uuid) returns int4 language sql immutable strict as $$ select case when a < b then -1 when a > b then 1 else 0 end $$;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.uuid_range_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4cmp",
      signature: "(public.uuid,public.uuid)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function btint4cmp"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.uuid_range_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(supportFunctionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
  }, 120000);

  test("orders custom subtype opclasses with built-in names before range types", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = int4_ops);",
      "create operator class int4_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "int4_ops",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class int4_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in opclass operators without argument lists", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.custom_int4_range not null);",
      "create type app.custom_int4_range as range (subtype = int4, subtype_opclass = app.int4_range_ops);",
      "create operator class app.int4_range_ops for type int4 using btree as operator 1 <, operator 2 <=, operator 3 =, operator 4 >=, operator 5 >, function 1 btint4cmp(int4, int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.int4_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.custom_int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders operator classes after explicit operator families", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score, subtype_opclass = app.score_ops);",
      "create operator class app.score_ops for type app.score using btree family app.score_family as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator family app.score_family using btree;",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_family",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family app.score_family"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(familyIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders operator classes after operator families used for ordering", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by app.score_sort_family, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator family app.score_sort_family using btree;",
      "create operator <-> (function = app.score_distance, leftarg = app.score, rightarg = app.score);",
      "create function app.score_consistent(internal, app.score, smallint, oid, internal) returns bool language internal immutable strict as 'gbt_int4_consistent';",
      "create function app.score_union(internal, internal) returns app.score language internal immutable strict as 'gbt_int4_union';",
      "create function app.score_compress(internal) returns internal language internal immutable strict as 'gbt_int4_compress';",
      "create function app.score_decompress(internal) returns internal language internal immutable strict as 'gbt_int4_decompress';",
      "create function app.score_penalty(internal, internal, internal) returns internal language internal immutable strict as 'gbt_int4_penalty';",
      "create function app.score_picksplit(internal, internal) returns internal language internal immutable strict as 'gbt_int4_picksplit';",
      "create function app.score_same(app.score, app.score, internal) returns internal language internal immutable strict as 'gbt_int4_same';",
      "create function app.score_distance(a app.score, b app.score) returns float8 language sql immutable strict as $$ select abs((a).value - (b).value)::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_sort_family",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family app.score_sort_family"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(familyIndex);
  }, 120000);

  test("provides implicit operator families from operator classes", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_score_ops for type text using btree family app.score_ops as operator 1 < (text, text), operator 2 <= (text, text), operator 3 = (text, text), operator 4 >= (text, text), operator 5 > (text, text), function 1 bttextcmp(text, text);",
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const providerStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const consumerStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.text_score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(providerStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
    expect(consumerStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const providerIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const consumerIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.text_score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(consumerIndex).toBeGreaterThan(providerIndex);
  }, 120000);

  test("uses opclass datatypes for omitted operator item arguments", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.<, function 1 app.score_cmp(app.score, app.score);",
      "create operator app.< (function = app.score_prefix, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create function app.score_prefix(value app.score) returns bool language sql immutable strict as $$ select (value).value < 0 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedOperatorDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator" && ref.schema === "app" && ref.name === "<",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "<",
      signature: "(app.score,app.score)",
    });
    expect(unresolvedOperatorDependency?.objectRefs).toContainEqual({
      kind: "operator",
      schema: "app",
      name: "<",
      signature: "(app.score,app.score)",
    });
  }, 120000);

  test("records operator class storage type dependencies", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as storage app.score_storage, operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score_storage as (value int4);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "score_storage",
    });
  }, 120000);

  test("orders operator classes after support function op types", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score), function 2 (app.other, app.other) app.score_sortsupport(internal);",
      "create function app.score_sortsupport(internal) returns void language internal immutable strict as 'btint4sortsupport';",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
      "create operator > (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator >= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator = (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator <= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator < (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_gt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value > (b).value $$;",
      "create function app.score_gte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value >= (b).value $$;",
      "create function app.score_eq(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create function app.score_lte(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value <= (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.other as (value int4);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "other",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const opTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.other"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(opTypeIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(opTypeIndex);
  }, 120000);

  test("does not require producer statements for built-in range operator classes", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.int4_range not null);",
      "create type app.int4_range as range (subtype = int4, subtype_opclass = int4_ops);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in range subtypes outside the core type list", async () => {
    const result = await analyzeAndSort([
      "create table app.networks(id int primary key, value_span app.mac_range not null);",
      "create type app.mac_range as range (subtype = macaddr8, subtype_opclass = macaddr8_ops);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.mac_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.networks"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in range collations", async () => {
    const cases = [
      {
        collationSql: '"default"',
        typeName: "default_label_range",
        tableName: "default_labels",
      },
      {
        collationSql: "ucs_basic",
        typeName: "ucs_basic_label_range",
        tableName: "ucs_basic_labels",
      },
      { collationSql: '"C"', typeName: "label_range", tableName: "labels" },
    ];

    const result = await analyzeAndSort([
      ...cases.flatMap((testCase) => [
        `create table app.${testCase.tableName}(id int primary key, value_span app.${testCase.typeName} not null);`,
        `create type app.${testCase.typeName} as range (subtype = text, collation = ${testCase.collationSql});`,
      ]),
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);

    for (const testCase of cases) {
      const rangeIndex = orderedSql.findIndex((sql) =>
        sql.includes(`create type app.${testCase.typeName}`),
      );
      const tableIndex = orderedSql.findIndex((sql) =>
        sql.includes(`create table app.${testCase.tableName}`),
      );

      expect(rangeIndex).toBeGreaterThan(schemaIndex);
      expect(tableIndex).toBeGreaterThan(rangeIndex);
    }
  }, 120000);

  test("orders explicitly qualified public range collations before the range type", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, value_span app.label_range not null);",
      'create type app.label_range as range (subtype = text, collation = public."C");',
      'create collation public."C" from pg_catalog."C";',
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const collationIndex = orderedSql.findIndex((sql) =>
      sql.includes('create collation public."c"'),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(collationIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(collationIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("provides explicit multirange type names", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, spans app.label_multirange not null);",
      "create type app.label_range as range (subtype = text, multirange_type_name = app.label_multirange);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("provides unqualified explicit multirange type names in the range schema", async () => {
    const result = await analyzeAndSort([
      "create table app.prices(id int primary key, spans app.price_multi not null);",
      "create type app.price_range as range (subtype = int4, multirange_type_name = price_multi);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.price_range"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.prices"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "price_multi",
    });
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("provides implicit multirange type names", async () => {
    const result = await analyzeAndSort([
      "create table app.prices(id int primary key, spans app.price_multirange not null);",
      "create type app.price_range as range (subtype = int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.prices"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("uses PostgreSQL default multirange names for embedded range substrings", async () => {
    const result = await analyzeAndSort([
      "create table app.time_buckets(id int primary key, spans app.timemultirange_bucket not null);",
      "create type app.timerange_bucket as range (subtype = time);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.timerange_bucket"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.time_buckets"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(schemaIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders canonical range functions through the shell type pattern", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, during app.int_range not null);",
      "create type app.int_range as range (subtype = int4, canonical = app.int_range_canonical);",
      "create function app.int_range_canonical(value app.int_range) returns app.int_range language internal immutable as 'int4range_canonical';",
      "create type app.int_range;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const cycleCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type app.int_range;",
    );
    const canonicalIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.int_range_canonical"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int_range as range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(unknownCount).toBe(0);
    expect(duplicateCount).toBe(0);
    expect(cycleCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(shellTypeIndex).toBeGreaterThan(schemaIndex);
    expect(canonicalIndex).toBeGreaterThan(shellTypeIndex);
    expect(rangeIndex).toBeGreaterThan(canonicalIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders unqualified public canonical range functions through shell types", async () => {
    const result = await analyzeAndSort([
      "create table events(id int primary key, during int_range not null);",
      "create type int_range as range (subtype = int4, canonical = int_range_canonical);",
      "create function int_range_canonical(value int_range) returns int_range language internal immutable as 'int4range_canonical';",
      "create type int_range;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const cycleCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type int_range;",
    );
    const canonicalIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function int_range_canonical"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type int_range as range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table events"),
    );

    expect(cycleCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(shellTypeIndex).toBeGreaterThanOrEqual(0);
    expect(canonicalIndex).toBeGreaterThan(shellTypeIndex);
    expect(rangeIndex).toBeGreaterThan(canonicalIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("preserves concrete providers for base type definitions", async () => {
    const result = await analyzeAndSort([
      "create table app.items(id int primary key, value app.widget not null);",
      "create type app.widget (input = app.widget_in, output = app.widget_out, internallength = 4, passedbyvalue, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const shellTypeIndex = orderedSql.findIndex(
      (sql) => sql.trim() === "create type app.widget;",
    );
    const inputFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.widget_in"),
    );
    const outputFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function app.widget_out"),
    );
    const baseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.widget ("),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.items"),
    );

    expect(unresolvedCount).toBe(0);
    expect(duplicateCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(shellTypeIndex).toBeGreaterThan(schemaIndex);
    expect(inputFunctionIndex).toBeGreaterThan(shellTypeIndex);
    expect(outputFunctionIndex).toBeGreaterThan(shellTypeIndex);
    expect(baseTypeIndex).toBeGreaterThan(inputFunctionIndex);
    expect(baseTypeIndex).toBeGreaterThan(outputFunctionIndex);
    expect(tableIndex).toBeGreaterThan(baseTypeIndex);
  }, 120000);

  test("orders base types after types referenced by LIKE", async () => {
    const result = await analyzeAndSort([
      "create table app.items(id int primary key, value app.child_widget not null);",
      "create type app.child_widget (input = app.child_widget_in, output = app.child_widget_out, like = app.parent_widget);",
      "create function app.child_widget_out(value app.child_widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.child_widget_in(value cstring) returns app.child_widget language internal immutable strict as 'int4in';",
      "create type app.child_widget;",
      "create type app.parent_widget (input = app.parent_widget_in, output = app.parent_widget_out, internallength = 4, passedbyvalue, alignment = int4);",
      "create function app.parent_widget_out(value app.parent_widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.parent_widget_in(value cstring) returns app.parent_widget language internal immutable strict as 'int4in';",
      "create type app.parent_widget;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const parentBaseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.parent_widget ("),
    );
    const childBaseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.child_widget ("),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.items"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(parentBaseTypeIndex).toBeGreaterThanOrEqual(0);
    expect(childBaseTypeIndex).toBeGreaterThan(parentBaseTypeIndex);
    expect(tableIndex).toBeGreaterThan(childBaseTypeIndex);
  }, 120000);
});
