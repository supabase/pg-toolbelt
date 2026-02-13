import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";

describe("statement coverage", () => {
  test("orders enum type before table using it", async () => {
    const result = await analyzeAndSort([
      "create table app.users(id int primary key, role app.user_role not null);",
      "create type app.user_role as enum ('admin', 'user');",
      "create schema app;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create schema app");
    expect(orderedSql[1]).toContain("create type app.user_role");
    expect(orderedSql[2]).toContain("create table app.users");
  });

  test("orders create role/schema before schema grant", async () => {
    const result = await analyzeAndSort([
      "grant usage on schema app to app_user;",
      "create schema app;",
      "create role app_user;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create role app_user");
    expect(orderedSql[1]).toContain("create schema app");
    expect(orderedSql[2]).toContain("grant usage on schema app to app_user");
  });

  test("orders table before publication, comment, and owner changes", async () => {
    const result = await analyzeAndSort([
      "create publication pub_users for table app.users;",
      "comment on table app.users is 'users table';",
      "alter table app.users owner to app_user;",
      "create table app.users(id int primary key);",
      "create schema app;",
      "create role app_user;",
    ]);
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const tableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table app.users"),
    );
    const publicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("create publication pub_users"),
    );
    const commentIndex = orderedSql.findIndex((sql) =>
      sql.includes("comment on table app.users"),
    );
    const ownerIndex = orderedSql.findIndex((sql) =>
      sql.includes("alter table app.users owner"),
    );

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(publicationIndex).toBeGreaterThan(tableIndex);
    expect(commentIndex).toBeGreaterThan(tableIndex);
    expect(ownerIndex).toBeGreaterThan(tableIndex);
  });

  test("orders referenced unique key provider before foreign key consumers", async () => {
    const result = await analyzeAndSort([
      "create table public.oauth_apps(id uuid primary key, created_by uuid references public.users(gotrue_id));",
      "create table public.users(id bigint primary key, gotrue_id uuid not null);",
      "create unique index users_gotrue_id_key on public.users using btree (gotrue_id);",
    ]);
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const usersTableIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table public.users"),
    );
    const usersUniqueIndex = orderedSql.findIndex((sql) =>
      sql.includes("create unique index users_gotrue_id_key"),
    );
    const oauthAppsIndex = orderedSql.findIndex((sql) =>
      sql.includes("create table public.oauth_apps"),
    );

    expect(unresolvedCount).toBe(0);
    expect(usersTableIndex).toBeGreaterThan(-1);
    expect(usersUniqueIndex).toBeGreaterThan(usersTableIndex);
    expect(oauthAppsIndex).toBeGreaterThan(usersUniqueIndex);
  });

  test("prioritizes foundational bootstrap classes before generic bootstrap statements", async () => {
    const result = await analyzeAndSort([
      "do $$ begin perform 1; end $$;",
      "set check_function_bodies = off;",
      'create extension if not exists "uuid-ossp";',
      "create schema app;",
      "create role app_user;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );

    expect(orderedClasses).toEqual([
      "CREATE_ROLE",
      "CREATE_SCHEMA",
      "CREATE_EXTENSION",
      "VARIABLE_SET",
      "DO",
    ]);
  });

  test("resolves overloads from explicit casted call-site signatures", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create function app.normalize(value text) returns text language sql as $$ select lower(value) $$;",
      "create function app.normalize(value jsonb) returns text language sql as $$ select value::text $$;",
      "create table app.events(payload jsonb not null);",
      "create view app.normalized_payload as select app.normalize(payload::jsonb) as normalized from app.events;",
    ]);
    const ambiguousDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "DUPLICATE_PRODUCER" &&
        diagnostic.message.includes("Ambiguous compatible producers"),
    );
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const jsonbFunctionIndex = orderedSql.findIndex(
      (sql) => sql.includes("normalize") && sql.includes("jsonb"),
    );
    const viewIndex = orderedSql.findIndex((sql) =>
      sql.includes("create view app.normalized_payload"),
    );

    expect(ambiguousDiagnostics).toHaveLength(0);
    expect(jsonbFunctionIndex).toBeGreaterThan(-1);
    expect(viewIndex).toBeGreaterThan(jsonbFunctionIndex);
  });
});
