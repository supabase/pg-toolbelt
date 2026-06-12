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

  test("preserves local float8mi subtype_diff functions", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create table measurements(id int primary key, value_span floatrange not null);",
      "create type floatrange as range (subtype = float8, subtype_diff = float8mi);",
      "create function float8mi(a float8, b float8) returns float8 language sql immutable strict as $$ select (a - b) * 2 $$;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type floatrange"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "float8mi",
      signature: "(public.float8,public.float8)",
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
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type floatrange"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table measurements"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(subtypeDiffIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(subtypeDiffIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not require producer statements for built-in subtype_diff helpers", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.int4_range not null);",
      "create type app.int4_range as range (subtype = int4, subtype_diff = int4range_subdiff);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int4_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4range_subdiff",
      signature: "(public.int4,public.int4)",
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
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

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
      signature: "(btree,int4)",
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

  test("orders omitted range subtype defaults through domain base opclasses", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score_domain);",
      "create domain app.score_domain as app.score;",
      "create operator class app.score_ops default for type app.score using btree as operator 1 app.< (app.score, app.score), operator 2 app.<= (app.score, app.score), operator 3 app.= (app.score, app.score), operator 4 app.>= (app.score, app.score), operator 5 app.> (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator app.> (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator app.>= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator app.= (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator app.<= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
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
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const opclassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.score_domain"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.score_range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(opclassIndex).toBeGreaterThanOrEqual(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(opclassIndex);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
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
      signature: "(internal,oid,internal,int4)",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
      signature: "(internal,oid,internal,int2,internal)",
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

  test("requires operator estimator functions with PostgreSQL signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = app.score_sel, join = app.score_join);",
      "create function app.score_join(value int4) returns float8 language sql immutable strict as $$ select value::float8 $$;",
      "create function app.score_sel(value int4) returns float8 language sql immutable strict as $$ select value::float8 $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<#"),
    );

    expect(unresolved).toHaveLength(2);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_sel",
      signature: "(internal,oid,internal,int4)",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
      signature: "(internal,oid,internal,int2,internal)",
    });
  });

  test("requires exact operator estimator signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.<# (function = app.score_lt, leftarg = app.score, rightarg = app.score, restrict = app.score_sel, join = app.score_join);",
      "create function app.score_join(internal, oid, internal, int2, internal, extra text default '') returns float8 language internal stable strict as 'eqjoinsel';",
      "create function app.score_sel(internal, oid, internal, int4, extra text default '') returns float8 language internal stable strict as 'eqsel';",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<#"),
    );

    expect(unresolved).toHaveLength(2);
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_sel",
      signature: "(internal,oid,internal,int4)",
    });
    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_join",
      signature: "(internal,oid,internal,int2,internal)",
    });
  });

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

  test("does not require producer statements for built-in text operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = int4eq, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4eq",
      signature: "(int4,int4)",
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
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator app.==="),
    );

    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorIndex).toBeGreaterThan(schemaIndex);
  }, 120000);

  test("does not require producer statements for non-equality built-in operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.<< (function = int4lt, leftarg = int4, rightarg = int4);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.<<"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4lt",
      signature: "(int4,int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producer statements for built-in float operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = float8eq, leftarg = float8, rightarg = float8);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "float8eq",
      signature: "(float8,float8)",
    });
  });

  test("requires exact operator implementation signatures", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create function app.score_eq(a app.score, b app.score, extra int4 default 0) returns boolean language sql immutable strict as $$ select (a).value = (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedImplementation = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_eq",
        ) === true,
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(operatorStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_eq",
      signature: "(app.score,app.score)",
    });
    expect(unresolvedImplementation?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_eq",
      signature: "(app.score,app.score)",
    });
  });

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
      signature: "(app.score,app.score)",
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

  test("requires canonical range functions with the range signature", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = int4, canonical = app.score_canonical);",
      "create function app.score_canonical(value int4) returns int4 language sql immutable as $$ select value $$;",
      "create schema app;",
    ]);
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );
    const unresolvedCanonicalDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_canonical",
        ) === true,
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)",
    });
    expect(unresolvedCanonicalDependency?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)",
    });
  }, 120000);

  test("requires subtype diff range functions with subtype signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = app.score, subtype_diff = app.score_diff);",
      "create function app.score_diff(value app.score) returns float8 language sql immutable strict as $$ select (value).value::float8 $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range"),
    );
    const unresolvedSubtypeDiffDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_diff",
        ) === true,
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_diff",
      signature: "(app.score,app.score)",
    });
    expect(unresolvedSubtypeDiffDependency?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_diff",
      signature: "(app.score,app.score)",
    });
  }, 120000);

  test("requires exact range support routine signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = int4, canonical = app.score_canonical);",
      "create function app.score_canonical(value app.score_range, extra int4 default 0) returns app.score_range language sql immutable as $$ select value $$;",
      "create type app.score_range;",
      "create schema app;",
    ]);
    const unresolvedCanonicalDependency = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_canonical",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score_range as"),
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)",
    });
    expect(unresolvedCanonicalDependency?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_canonical",
      signature: "(app.score_range)",
    });
  });

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

  test("requires exact opclass support function signatures", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score, extra int4 default 0) returns int4 language sql immutable strict as $$ select (a).value - (b).value + extra $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedSupportFunction = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "score_cmp",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_cmp",
      signature: "(app.score,app.score)",
    });
    expect(unresolvedSupportFunction?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_cmp",
      signature: "(app.score,app.score)",
    });
  }, 120000);

  test("does not require producer statements for built-in opclass sortsupport functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_sort_ops for type int4 using btree as operator 1 < (int4, int4), operator 2 <= (int4, int4), operator 3 = (int4, int4), operator 4 >= (int4, int4), operator 5 > (int4, int4), function 1 btint4cmp(int4, int4), function 2 btint4sortsupport(internal);",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_sort_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "btint4sortsupport",
      signature: "(internal)",
    });
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
      signature: "(btree,app.score)",
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

  test("orders custom range types after default subtype operator classes", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score);",
      "create operator class app.score_ops default for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
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
      schema: "app",
      name: "score_ops",
      signature: "(btree,app.score)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
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
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("orders custom range types after any default subtype operator class name", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.score_range not null);",
      "create type app.score_range as range (subtype = app.score);",
      "create operator class app.my_score_default default for type app.score using btree as operator 1 < (app.score, app.score), operator 2 <= (app.score, app.score), operator 3 = (app.score, app.score), operator 4 >= (app.score, app.score), operator 5 > (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
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
      schema: "app",
      name: "my_score_default",
      signature: "(btree,app.score)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.my_score_default"),
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

  test("matches order-by operator family signatures to providers", async () => {
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
    const operatorFamilyStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator family app.score_sort_family"),
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorFamilyStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_sort_family",
      signature: "(btree)",
    });
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_sort_family",
      signature: "(btree)",
    });
  });

  test("does not require producer statements for built-in order-by operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_float_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by float_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator class app.score_integer_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by integer_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
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
    const floatOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_float_ops"),
    );
    const integerOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_integer_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(floatOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "float_ops",
      signature: "(btree)",
    });
    expect(integerOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "integer_ops",
      signature: "(btree)",
    });
  });

  test("does not require producer statements for unqualified built-in operator class families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree family integer_ops as operator 1 app.< (app.score, app.score), operator 2 app.<= (app.score, app.score), operator 3 app.= (app.score, app.score), operator 4 app.>= (app.score, app.score), operator 5 app.> (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator app.> (function = app.score_gt, leftarg = app.score, rightarg = app.score);",
      "create operator app.>= (function = app.score_gte, leftarg = app.score, rightarg = app.score);",
      "create operator app.= (function = app.score_eq, leftarg = app.score, rightarg = app.score);",
      "create operator app.<= (function = app.score_lte, leftarg = app.score, rightarg = app.score);",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select case when (a).value < (b).value then -1 when (a).value > (b).value then 1 else 0 end $$;",
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
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "integer_ops",
      signature: "(btree)",
    });
  });

  test("preserves local order-by operator families with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.score_ops for type app.score using gist as operator 1 <-> (app.score, app.score) for order by integer_ops, function 1 app.score_consistent(internal, app.score, smallint, oid, internal), function 2 app.score_union(internal, internal), function 3 app.score_compress(internal), function 4 app.score_decompress(internal), function 5 app.score_penalty(internal, internal, internal), function 6 app.score_picksplit(internal, internal), function 7 app.score_same(app.score, app.score, internal);",
      "create operator family integer_ops using btree;",
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
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const familyIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator family integer_ops"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "public",
      name: "integer_ops",
      signature: "(btree)",
    });
    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(familyIndex);
  });

  test("preserves unqualified custom opclass support operators", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.score_ops for type int4 using btree as operator 1 < (int4, int4), function 1 btint4cmp(int4, int4);",
      "create operator < (function = app.score_lt, leftarg = int4, rightarg = int4);",
      "create function app.score_lt(a int4, b int4) returns boolean language sql immutable strict as $$ select a < b $$;",
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
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(public.int4,public.int4)",
    });

    const validation = await validateAnalyzeResultWithPostgres(result);
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator <"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.score_ops"),
    );

    expect(executionErrors).toHaveLength(0);
    expect(operatorIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(operatorIndex);
  }, 120000);

  test("preserves local opclass support functions with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create operator class app.uuid_ops for type uuid using btree as function 1 uuid_cmp(uuid, uuid);",
      "create function uuid_cmp(a uuid, b uuid) returns int4 language sql immutable strict as $$ select pg_catalog.uuid_cmp(a, b) $$;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.uuid_ops"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const supportFunctionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function uuid_cmp"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.uuid_ops"),
    );

    expect(unresolvedCount).toBe(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "uuid_cmp",
      signature: "(public.uuid,public.uuid)",
    });
    expect(supportFunctionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(supportFunctionIndex);
  });

  test("does not require producer statements for polymorphic built-in opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.mood_ops for type app.mood using btree as function 1 enum_cmp(app.mood, app.mood);",
      "create operator class app.score_array_ops for type app.score[] using btree as function 1 btarraycmp(app.score[], app.score[]);",
      "create type app.score as (value int4);",
      "create type app.mood as enum ('sad', 'ok');",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const moodOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.mood_ops"),
    );
    const arrayOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_array_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(moodOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "enum_cmp",
      signature: "(app.mood,app.mood)",
    });
    expect(arrayOperatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "btarraycmp",
      signature: "(app.score[],app.score[])",
    });
  });

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

  test("does not duplicate explicitly created implicit operator families", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as operator 1 app.< (app.score, app.score), function 1 app.score_cmp(app.score, app.score);",
      "create operator family app.score_ops using btree;",
      "create operator app.< (function = app.score_lt, leftarg = app.score, rightarg = app.score);",
      "create function app.score_cmp(a app.score, b app.score) returns int4 language sql immutable strict as $$ select (a).value - (b).value $$;",
      "create function app.score_lt(a app.score, b app.score) returns boolean language sql immutable strict as $$ select (a).value < (b).value $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const duplicateCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    ).length;
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );
    const operatorFamilyStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator family app.score_ops"),
    );

    expect(duplicateCount).toBe(0);
    expect(operatorFamilyStatement?.provides).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
    expect(operatorClassStatement?.provides).not.toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "operator_family",
      schema: "app",
      name: "score_ops",
      signature: "(btree)",
    });
  });

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

  test("does not require producer statements for pg_catalog opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create table app.measurements(id int primary key, value_span app.uuid_range not null);",
      "create type app.uuid_range as range (subtype = uuid, subtype_opclass = app.uuid_range_ops);",
      "create operator class app.uuid_range_ops for type uuid using btree as operator 1 < (uuid, uuid), operator 2 <= (uuid, uuid), operator 3 = (uuid, uuid), operator 4 >= (uuid, uuid), operator 5 > (uuid, uuid), function 1 uuid_cmp(uuid, uuid);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.uuid_range_ops"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const schemaIndex = orderedSql.findIndex((sql) =>
      sql.includes("create schema app"),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class app.uuid_range_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.uuid_range"),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.measurements"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "uuid_cmp",
      signature: "(uuid,uuid)",
    });
    expect(executionErrors).toHaveLength(0);
    expect(schemaIndex).toBeGreaterThanOrEqual(0);
    expect(operatorClassIndex).toBeGreaterThan(schemaIndex);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
    expect(tableIndex).toBeGreaterThan(rangeIndex);
  }, 120000);

  test("does not treat range_cmp as built-in support for non-range scalar opclasses", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_ops for type app.score using btree as function 1 range_cmp(app.score, app.score);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolvedRangeCmp = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "range_cmp" &&
            ref.signature === "(app.score,app.score)",
        ) === true,
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_ops"),
    );

    expect(unresolvedRangeCmp.length).toBeGreaterThan(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "public",
      name: "range_cmp",
      signature: "(app.score,app.score)",
    });
  });

  test("does not require producers for pg_catalog hash opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.int4_hash_ops for type int4 using hash as operator 1 = (int4, int4), function 1 hashint4(int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.int4_hash_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "hashint4",
      signature: "(int4)",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producers for pg_catalog text hash support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.text_hash_ops for type text using hash as operator 1 = (text, text), function 1 hashtext(text);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedHashtext = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) => ref.kind === "function" && ref.name === "hashtext",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.text_hash_ops"),
    );

    expect(unresolvedHashtext).toHaveLength(0);
    expect(
      operatorClassStatement?.requires.some(
        (ref) => ref.kind === "function" && ref.name === "hashtext",
      ),
    ).toBe(false);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producers for pg_catalog enum and array support operators", async () => {
    const result = await analyzeAndSort([
      "create operator class app.mood_ops for type app.mood using btree as operator 1 < (app.mood, app.mood), operator 2 <= (app.mood, app.mood), operator 3 = (app.mood, app.mood), operator 4 >= (app.mood, app.mood), operator 5 > (app.mood, app.mood), function 1 enum_cmp(app.mood, app.mood);",
      "create operator class app.score_array_ops for type app.score[] using btree as operator 1 < (app.score[], app.score[]), operator 2 <= (app.score[], app.score[]), operator 3 = (app.score[], app.score[]), operator 4 >= (app.score[], app.score[]), operator 5 > (app.score[], app.score[]), function 1 btarraycmp(app.score[], app.score[]);",
      "create type app.score as (value int4);",
      "create type app.mood as enum ('sad', 'ok');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const moodOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.mood_ops"),
    );
    const arrayOperatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_array_ops"),
    );

    expect(unresolved).toHaveLength(0);
    expect(moodOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(app.mood,app.mood)",
    });
    expect(arrayOperatorClassStatement?.requires).not.toContainEqual({
      kind: "operator",
      schema: "public",
      name: "<",
      signature: "(app.score[],app.score[])",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not require producers for unary pg_catalog operator callbacks", async () => {
    const result = await analyzeAndSort([
      "create operator app.- (function = int4um, rightarg = int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedInt4um = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.name === "int4um" &&
            ref.signature === "(public.int4)",
        ) === true,
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.-"),
    );

    expect(unresolvedInt4um).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "int4um",
      signature: "(public.int4)",
    });
    expect(executionErrors).toHaveLength(0);
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

  test("does not report missing default opclasses for pg_catalog polymorphic defaults", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, mood_span app.mood_range not null, mood_arrays app.mood_array_range not null, nested app.mood_nested_range not null);",
      "create type app.mood_nested_range as range (subtype = app.mood_range);",
      "create type app.mood_array_range as range (subtype = app.mood[]);",
      "create type app.mood_range as range (subtype = app.mood);",
      "create type app.mood as enum ('sad', 'ok');",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("does not report missing default opclasses for domain range subtypes over built-ins", async () => {
    const result = await analyzeAndSort([
      "create type app.price_range as range (subtype = app.price);",
      "create domain app.price as numeric;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "No default btree operator class provider found for range subtype 'app.price'",
        ),
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.price"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );

    expect(missingDefault).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
    expect(domainIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(domainIndex);
  }, 120000);

  test("does not require producer statements for pg_lsn range operator classes", async () => {
    const result = await analyzeAndSort([
      "create type app.lsn_range as range (subtype = pg_lsn, subtype_opclass = pg_lsn_ops);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.lsn_range"),
    );

    expect(unresolved).toHaveLength(0);
    expect(rangeStatement?.requires).not.toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "pg_lsn_ops",
      signature: "btree",
    });
  });

  test("preserves local range opclasses with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create type app.int4_range as range (subtype = int4, subtype_opclass = int4_ops);",
      "create operator class int4_ops for type int4 using btree as operator 1 app.<# (int4, int4), function 1 app.int4_cmp(int4, int4);",
      "create operator app.<# (function = int4lt, leftarg = int4, rightarg = int4);",
      "create function app.int4_cmp(a int4, b int4) returns int4 language internal immutable strict as 'btint4cmp';",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.int4_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const operatorClassIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator class int4_ops"),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.int4_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "public",
      name: "int4_ops",
      signature: "(btree,int4)",
    });
    expect(operatorClassIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(operatorClassIndex);
  });

  test("requires explicit range opclasses for the range subtype", async () => {
    const result = await analyzeAndSort([
      "create type app.r as range (subtype = int4, subtype_opclass = app.shared_ops);",
      "create operator class app.shared_ops for type text using btree as function 1 bttextcmp(text, text);",
      "create schema app;",
    ]);
    const missingInt4Opclass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "app" &&
            ref.name === "shared_ops" &&
            ref.signature === "(btree,int4)",
        ) === true,
    );
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.r"),
    );

    expect(rangeStatement?.requires).toContainEqual({
      kind: "operator_class",
      schema: "app",
      name: "shared_ops",
      signature: "(btree,int4)",
    });
    expect(missingInt4Opclass).toHaveLength(1);
  });

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

  test("does not report missing default opclasses for omitted built-in range subtypes outside the core type list", async () => {
    const result = await analyzeAndSort([
      "create table app.shifts(id int primary key, during app.timetz_range not null);",
      "create type app.timetz_range as range (subtype = timetz);",
      "create schema app;",
    ]);
    const missingDefault = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes("No default btree operator class provider"),
    );

    expect(missingDefault).toHaveLength(0);
  });

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

  test("preserves local unqualified range collations with built-in names", async () => {
    const result = await analyzeAndSort([
      "set search_path = public, pg_catalog;",
      "create table app.labels(id int primary key, value_span app.label_range not null);",
      'create type app.label_range as range (subtype = text, collation = "C");',
      'create collation "C" from pg_catalog."C";',
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const rangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.label_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const collationIndex = orderedSql.findIndex((sql) =>
      sql.includes('create collation "c"'),
    );
    const rangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );

    expect(unresolvedCount).toBe(0);
    expect(rangeStatement?.requires).toContainEqual({
      kind: "collation",
      schema: "public",
      name: "C",
    });
    expect(collationIndex).toBeGreaterThanOrEqual(0);
    expect(rangeIndex).toBeGreaterThan(collationIndex);
  });

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

  test("provides array refs for explicit and implicit multirange type names", async () => {
    const result = await analyzeAndSort([
      "create table app.labels(id int primary key, spans app.label_multirange[] not null);",
      "create table app.prices(id int primary key, spans app.price_multirange[] not null);",
      "create type app.label_range as range (subtype = text, multirange_type_name = app.label_multirange);",
      "create type app.price_range as range (subtype = int4);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const explicitRangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.label_range"),
    );
    const implicitRangeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.price_range"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const explicitRangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.label_range"),
    );
    const implicitRangeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.price_range"),
    );
    const labelsTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.labels"),
    );
    const pricesTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.prices"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(explicitRangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "label_multirange[]",
    });
    expect(implicitRangeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "price_multirange[]",
    });
    expect(labelsTableIndex).toBeGreaterThan(explicitRangeIndex);
    expect(pricesTableIndex).toBeGreaterThan(implicitRangeIndex);
  }, 120000);

  test("provides array refs for composite and table row types", async () => {
    const result = await analyzeAndSort([
      "create table app.events(id int primary key, emails app.email[] not null, rows app.row_type[] not null, sources app.source_table[] not null, view_rows app.source_view[] not null, materialized_rows app.source_mat_view[] not null);",
      "create domain app.email as text;",
      "create type app.row_type as (value int4);",
      "create table app.source_table(id int primary key);",
      "create view app.source_view as select id from app.source_table;",
      "create materialized view app.source_mat_view as select id from app.source_table;",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const compositeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.row_type"),
    );
    const domainStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create domain app.email"),
    );
    const sourceTableStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create table app.source_table"),
    );
    const sourceViewStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create view app.source_view"),
    );
    const sourceMatViewStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create materialized view app.source_mat_view"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const compositeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.row_type"),
    );
    const domainIndex = orderedSql.findIndex((sql) =>
      sql.includes("create domain app.email"),
    );
    const sourceTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.source_table"),
    );
    const sourceViewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.source_view"),
    );
    const sourceMatViewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create materialized view app.source_mat_view"),
    );
    const eventsTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.events"),
    );

    expect(unresolvedCount).toBe(0);
    expect(executionErrors).toHaveLength(0);
    expect(compositeStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "row_type[]",
    });
    expect(domainStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "email[]",
    });
    expect(sourceTableStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "source_table[]",
    });
    expect(sourceViewStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "source_view[]",
    });
    expect(sourceMatViewStatement?.provides).toContainEqual({
      kind: "type",
      schema: "app",
      name: "source_mat_view[]",
    });
    expect(compositeIndex).toBeGreaterThanOrEqual(0);
    expect(domainIndex).toBeGreaterThan(compositeIndex);
    expect(sourceTableIndex).toBeGreaterThan(compositeIndex);
    expect(sourceViewIndex).toBeGreaterThan(sourceTableIndex);
    expect(sourceMatViewIndex).toBeGreaterThan(sourceTableIndex);
    expect(eventsTableIndex).toBeGreaterThan(domainIndex);
    expect(eventsTableIndex).toBeGreaterThan(sourceTableIndex);
    expect(eventsTableIndex).toBeGreaterThan(sourceViewIndex);
    expect(eventsTableIndex).toBeGreaterThan(sourceMatViewIndex);
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

  test("orders base types after element types", async () => {
    const result = await analyzeAndSort([
      "create table app.items(id int primary key, value app.widget not null);",
      "create type app.widget (input = app.widget_in, output = app.widget_out, element = app.elem, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.elem as (value int4);",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedCount).toBe(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "type",
      schema: "app",
      name: "elem",
    });

    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const elementTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.elem"),
    );
    const baseTypeIndex = orderedSql.findIndex((sql) =>
      sql.includes("create type app.widget ("),
    );

    expect(elementTypeIndex).toBeGreaterThanOrEqual(0);
    expect(baseTypeIndex).toBeGreaterThan(elementTypeIndex);
  }, 120000);

  test("requires base type support functions with PostgreSQL signatures", async () => {
    const result = await analyzeAndSort([
      "create type app.score (input = app.score_in, output = app.score_out, internallength = 4, alignment = int4);",
      "create function app.score_out(value app.score) returns cstring language internal immutable strict as 'int4out';",
      "create function app.score_in(value int4) returns app.score language sql immutable strict as $$ select null::app.score $$;",
      "create type app.score;",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.score ("),
    );

    expect(unresolved).toHaveLength(1);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_in",
      signature: "(cstring)",
    });
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_out",
      signature: "(app.score)",
    });
  });

  test("does not satisfy exact base type callbacks with shorter overloads", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring, extra int4 default 0) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedInputFunction = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "function" &&
            ref.schema === "app" &&
            ref.name === "widget_in",
        ) === true,
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_in",
      signature: "(cstring)",
    });
    expect(unresolvedInputFunction?.objectRefs).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_in",
      signature: "(cstring)",
    });
  });

  test("accepts three-argument base type input callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, internallength = 4, alignment = int4);",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring, type_oid oid, typmod int4) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedCount).toBe(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_in",
      signature: "(cstring,oid,int4)",
    });
  });

  test("accepts three-argument base type receive callbacks", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, receive = app.widget_recv, send = app.widget_send, internallength = 4, alignment = int4);",
      "create function app.widget_send(value app.widget) returns bytea language internal immutable strict as 'int4send';",
      "create function app.widget_recv(value internal, type_oid oid, typmod int4) returns app.widget language internal immutable strict as 'int4recv';",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );

    expect(unresolvedCount).toBe(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_recv",
      signature: "(internal,oid,int4)",
    });
  });

  test("does not require producer statements for built-in operator implementation functions", async () => {
    const result = await analyzeAndSort([
      "create operator app.=== (function = texteq, leftarg = text, rightarg = text);",
      "create schema app;",
    ]);
    const validation = await validateAnalyzeResultWithPostgres(result);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator app.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).not.toContainEqual({
      kind: "function",
      schema: "public",
      name: "texteq",
      signature: "(text,text)",
    });
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("preserves local operator implementation functions with built-in names", async () => {
    const result = await analyzeAndSort([
      "create operator public.=== (function = texteq, leftarg = text, rightarg = text);",
      "create function public.texteq(a text, b text) returns boolean language sql immutable strict as $$ select a operator(pg_catalog.=) b $$;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator public.==="),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function public.texteq"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator public.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).toContainEqual(
      expect.objectContaining({
        kind: "function",
        schema: "public",
        name: "texteq",
      }),
    );
    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorIndex).toBeGreaterThan(functionIndex);
  });

  test("preserves local operator estimator functions with built-in names", async () => {
    const result = await analyzeAndSort([
      "create operator public.=== (function = texteq, leftarg = text, rightarg = text, restrict = eqsel);",
      "create function public.eqsel(internal, oid, internal, integer) returns float8 language internal stable strict as 'eqsel';",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create operator public.==="),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function public.eqsel"),
    );
    const operatorIndex = orderedSql.findIndex((sql) =>
      sql.includes("create operator public.==="),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorStatement?.requires).toContainEqual(
      expect.objectContaining({
        kind: "function",
        schema: "public",
        name: "eqsel",
        signature: "(internal,oid,internal,int4)",
      }),
    );
    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(operatorIndex).toBeGreaterThan(functionIndex);
  });

  test("reports missing default range subtype operator class providers", async () => {
    const result = await analyzeAndSort([
      "create type app.score_range as range (subtype = app.score);",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const missingDefaultOpclass = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "default btree operator class provider found for range subtype 'app.score'",
        ),
    );

    expect(missingDefaultOpclass?.objectRefs).toContainEqual({
      kind: "type",
      schema: "app",
      name: "score",
    });
  });

  test("reports missing default range opclasses for built-in subtypes without defaults", async () => {
    const result = await analyzeAndSort([
      "create type app.point_range as range (subtype = point);",
      "create schema app;",
    ]);
    const missingDefaultOpclass = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.message.includes(
          "default btree operator class provider found for range subtype",
        ),
    );

    expect(missingDefaultOpclass?.objectRefs).toContainEqual({
      kind: "type",
      schema: "public",
      name: "point",
    });
  });

  test("matches typmod input functions with array argument providers", async () => {
    const result = await analyzeAndSort([
      "create type app.widget (input = app.widget_in, output = app.widget_out, typmod_in = app.widget_typmod_in, typmod_out = app.widget_typmod_out, internallength = 4, alignment = int4);",
      "create function app.widget_typmod_out(value int4) returns cstring language sql immutable strict as $$ select $1::text::cstring $$;",
      "create function app.widget_typmod_in(value cstring[]) returns int4 language sql immutable strict as $$ select 0 $$;",
      "create function app.widget_out(value app.widget) returns cstring language internal immutable strict as 'int4out';",
      "create function app.widget_in(value cstring) returns app.widget language internal immutable strict as 'int4in';",
      "create type app.widget;",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const baseTypeStatement = result.ordered.find((statement) =>
      statement.sql.toLowerCase().includes("create type app.widget ("),
    );
    const typmodFunctionStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create function app.widget_typmod_in"),
    );

    expect(unresolved).toHaveLength(0);
    expect(baseTypeStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_typmod_in",
      signature: "(cstring[])",
    });
    expect(typmodFunctionStatement?.provides).toContainEqual({
      kind: "function",
      schema: "app",
      name: "widget_typmod_in",
      signature: "(cstring[])",
    });
  });

  test("preserves custom array type signatures for opclass support functions", async () => {
    const result = await analyzeAndSort([
      "create operator class app.score_array_ops for type app.score[] using btree as function 1 app.score_array_cmp(app.score[], app.score[]);",
      "create function app.score_array_cmp(a app.score[], b app.score[]) returns int4 language sql immutable strict as $$ select cardinality(a) - cardinality(b) $$;",
      "create type app.score as (value int4);",
      "create schema app;",
    ]);
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );
    const operatorClassStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create operator class app.score_array_ops"),
    );
    const functionStatement = result.ordered.find((statement) =>
      statement.sql
        .toLowerCase()
        .includes("create function app.score_array_cmp"),
    );

    expect(unresolved).toHaveLength(0);
    expect(operatorClassStatement?.requires).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_array_cmp",
      signature: "(app.score[],app.score[])",
    });
    expect(functionStatement?.provides).toContainEqual({
      kind: "function",
      schema: "app",
      name: "score_array_cmp",
      signature: "(app.score[],app.score[])",
    });
  });
});
