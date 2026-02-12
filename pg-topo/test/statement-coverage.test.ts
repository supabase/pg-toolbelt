import { afterAll, describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { createTempFixtureHarness } from "./support/temp-fixture";

const fixtures = createTempFixtureHarness("pg-topo-coverage-");
const createSqlFixture = fixtures.createSqlFixture;

afterAll(fixtures.cleanup);

describe("statement coverage", () => {
  test("orders enum type before table using it", async () => {
    const root = await createSqlFixture({
      "00_table.sql": "create table app.users(id int primary key, role app.user_role not null);",
      "01_enum.sql": "create type app.user_role as enum ('admin', 'user');",
      "02_schema.sql": "create schema app;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) => statement.sql.toLowerCase());

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create schema app");
    expect(orderedSql[1]).toContain("create type app.user_role");
    expect(orderedSql[2]).toContain("create table app.users");
  });

  test("orders create role/schema before schema grant", async () => {
    const root = await createSqlFixture({
      "00_grant.sql": "grant usage on schema app to app_user;",
      "01_schema.sql": "create schema app;",
      "02_role.sql": "create role app_user;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) => statement.sql.toLowerCase());

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(orderedSql[0]).toContain("create role app_user");
    expect(orderedSql[1]).toContain("create schema app");
    expect(orderedSql[2]).toContain("grant usage on schema app to app_user");
  });

  test("orders table before publication, comment, and owner changes", async () => {
    const root = await createSqlFixture({
      "00_publication.sql": "create publication pub_users for table app.users;",
      "01_comment.sql": "comment on table app.users is 'users table';",
      "02_owner.sql": "alter table app.users owner to app_user;",
      "03_table.sql": "create table app.users(id int primary key);",
      "04_schema.sql": "create schema app;",
      "05_role.sql": "create role app_user;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const unknownCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;

    const orderedSql = result.ordered.map((statement) => statement.sql.toLowerCase());
    const tableIndex = orderedSql.findIndex((sql) => sql.includes("create table app.users"));
    const publicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("create publication pub_users"),
    );
    const commentIndex = orderedSql.findIndex((sql) => sql.includes("comment on table app.users"));
    const ownerIndex = orderedSql.findIndex((sql) => sql.includes("alter table app.users owner"));

    expect(unknownCount).toBe(0);
    expect(unresolvedCount).toBe(0);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(publicationIndex).toBeGreaterThan(tableIndex);
    expect(commentIndex).toBeGreaterThan(tableIndex);
    expect(ownerIndex).toBeGreaterThan(tableIndex);
  });

  test("orders referenced unique key provider before foreign key consumers", async () => {
    const root = await createSqlFixture({
      "00_fk_consumer.sql":
        "create table public.oauth_apps(id uuid primary key, created_by uuid references public.users(gotrue_id));",
      "01_users.sql": "create table public.users(id bigint primary key, gotrue_id uuid not null);",
      "02_unique_index.sql":
        "create unique index users_gotrue_id_key on public.users using btree (gotrue_id);",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const unresolvedCount = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    ).length;
    const orderedSql = result.ordered.map((statement) => statement.sql.toLowerCase());
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
    const root = await createSqlFixture({
      "00_do.sql": "do $$ begin perform 1; end $$;",
      "01_set.sql": "set check_function_bodies = off;",
      "02_extension.sql": 'create extension if not exists "uuid-ossp";',
      "03_schema.sql": "create schema app;",
      "04_role.sql": "create role app_user;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const orderedClasses = result.ordered.map((statement) => statement.statementClass);

    expect(orderedClasses).toEqual([
      "CREATE_ROLE",
      "CREATE_SCHEMA",
      "CREATE_EXTENSION",
      "VARIABLE_SET",
      "DO",
    ]);
  });

  test("resolves overloads from explicit casted call-site signatures", async () => {
    const root = await createSqlFixture({
      "00_schema.sql": "create schema app;",
      "01_fn_text.sql":
        "create function app.normalize(value text) returns text language sql as $$ select lower(value) $$;",
      "02_fn_jsonb.sql":
        "create function app.normalize(value jsonb) returns text language sql as $$ select value::text $$;",
      "03_table.sql": "create table app.events(payload jsonb not null);",
      "04_view.sql":
        "create view app.normalized_payload as select app.normalize(payload::jsonb) as normalized from app.events;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const ambiguousDiagnostics = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "DUPLICATE_PRODUCER" &&
        diagnostic.message.includes("Ambiguous compatible producers"),
    );
    const normalizeJsonbEdge = result.graph.edges.find(
      (edge) =>
        edge.objectRef?.kind === "function" &&
        edge.objectRef.schema === "app" &&
        edge.objectRef.name === "normalize" &&
        (edge.objectRef.signature ?? "").includes("jsonb") &&
        edge.from.filePath.endsWith("02_fn_jsonb.sql") &&
        edge.to.filePath.endsWith("04_view.sql"),
    );
    const jsonbFunctionIndex = result.ordered.findIndex((statement) =>
      statement.id.filePath.endsWith("02_fn_jsonb.sql"),
    );
    const viewIndex = result.ordered.findIndex((statement) =>
      statement.id.filePath.endsWith("04_view.sql"),
    );

    expect(ambiguousDiagnostics).toHaveLength(0);
    expect(normalizeJsonbEdge).toBeDefined();
    expect(jsonbFunctionIndex).toBeGreaterThan(-1);
    expect(viewIndex).toBeGreaterThan(jsonbFunctionIndex);
  });
});
