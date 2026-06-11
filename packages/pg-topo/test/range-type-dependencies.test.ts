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
});
