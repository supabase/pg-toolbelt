import { afterAll, describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";
import { analyzeAndSortFromRandomizedStatements } from "./support/randomized-runtime-analysis";
import { createTempFixtureHarness } from "./support/temp-fixture";

const fixtures = createTempFixtureHarness("pg-topo-ext-");
const createSqlFixture = fixtures.createSqlFixture;

afterAll(fixtures.cleanup);

describe("postgres runtime validation", () => {
  test("keeps extension object dependencies unresolved in static analysis", async () => {
    const root = await createSqlFixture({
      "00_table.sql":
        "create table public.demo(id uuid default extensions.uuid_generate_v4() primary key);",
      "01_schema.sql": "create schema extensions;",
      "02_extension.sql":
        'create extension if not exists "uuid-ossp" with schema extensions;',
    });

    const result = await analyzeAndSort({ roots: [root] });
    const unresolved = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved.length).toBeGreaterThan(0);
  });

  test("validator executes installed extensions on postgres-alpine", async () => {
    const root = await createSqlFixture({
      "00_schema.sql": "create schema if not exists extensions;",
      "01_extension.sql":
        'create extension if not exists "uuid-ossp" with schema extensions;',
      "02_table.sql":
        "create table public.demo(id uuid default extensions.uuid_generate_v4() primary key);",
    });

    const result = await analyzeAndSortFromRandomizedStatements({
      roots: [root],
      seed: 31,
    });
    const validation = await validateAnalyzeResultWithPostgres(result);
    const allDiagnostics = [...result.diagnostics, ...validation.diagnostics];
    const environmentLimitations = allDiagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ENVIRONMENT_LIMITATION",
    );
    const executionErrors = allDiagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(environmentLimitations).toHaveLength(0);
    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("validator assumes external dependencies when producer is absent and no bootstrap migration is provided", async () => {
    const root = await createSqlFixture({
      "00_view.sql":
        "create view public.external_users as select * from external.users;",
    });

    const result = await analyzeAndSortFromRandomizedStatements({
      roots: [root],
      seed: 37,
    });
    const validation = await validateAnalyzeResultWithPostgres(result);
    const assumedExternal = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
    );

    expect(assumedExternal.length).toBeGreaterThan(0);
  }, 120000);

  test("validator can apply initial migration sql for external relation dependencies", async () => {
    const root = await createSqlFixture({
      "00_view.sql":
        "create view public.external_users as select * from external.users;",
      "01_view.sql":
        "create view public.external_users_copy as select * from public.external_users;",
    });

    const result = await analyzeAndSortFromRandomizedStatements({
      roots: [root],
      seed: 41,
    });
    const withoutBootstrap = await validateAnalyzeResultWithPostgres(result);
    const withBootstrap = await validateAnalyzeResultWithPostgres(result, {
      initialMigrationSql: `
          create schema if not exists external;
          create table if not exists external.users(id bigint primary key);
        `,
    });

    const withoutBootstrapAssumed = withoutBootstrap.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
    ).length;
    const withBootstrapAssumed = withBootstrap.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
    );
    const withBootstrapExecutionErrors = withBootstrap.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(withoutBootstrapAssumed).toBeGreaterThan(0);
    expect(withBootstrapAssumed).toHaveLength(0);
    expect(withBootstrapExecutionErrors).toHaveLength(0);
  }, 120000);

  test("validator can apply initial migration sql for extension-provided functions", async () => {
    const root = await createSqlFixture({
      "00_table.sql":
        "create table public.demo(id uuid default extensions.uuid_generate_v4() primary key);",
    });

    const result = await analyzeAndSortFromRandomizedStatements({
      roots: [root],
      seed: 43,
    });
    const withoutBootstrap = await validateAnalyzeResultWithPostgres(result);
    const withBootstrap = await validateAnalyzeResultWithPostgres(result, {
      initialMigrationSql: `
          create schema if not exists extensions;
          create extension if not exists "uuid-ossp" with schema extensions;
        `,
    });

    const withoutBootstrapAssumed = withoutBootstrap.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
    ).length;
    const withBootstrapAssumed = withBootstrap.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
    );
    const withBootstrapExecutionErrors = withBootstrap.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(withoutBootstrapAssumed).toBeGreaterThan(0);
    expect(withBootstrapAssumed).toHaveLength(0);
    expect(withBootstrapExecutionErrors).toHaveLength(0);
  }, 120000);

  test("sorts comments RLS/FK/index/trigger/policy statements and executes with bootstrap dependencies", async () => {
    const root = await createSqlFixture({
      "00_policy_delete.sql":
        "create policy comments_delete_owner on public.comments for delete to authenticated using ((( select auth.uid() as uid) = author_id));",
      "01_fk_comment_likes.sql":
        "alter table public.comment_likes add constraint comment_likes_comment_id_fkey foreign key (comment_id) references public.comments(id) on delete cascade;",
      "02_index_post.sql":
        "create index idx_comments_post_id on public.comments (post_id);",
      "03_trigger.sql":
        "create trigger trg_comments_updated_at before update on public.comments for each row execute function public.update_updated_at_column();",
      "04_policy_insert.sql":
        "create policy comments_insert_owner_check on public.comments for insert to authenticated with check ((( select auth.uid() as uid) = author_id));",
      "05_table_comments.sql":
        "create table public.comments (id uuid default gen_random_uuid() not null, post_id uuid not null, author_id uuid, parent_id uuid, body text not null, is_public boolean default true not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);",
      "06_enable_rls.sql":
        "alter table public.comments enable row level security;",
      "07_policy_update.sql":
        "create policy comments_update_owner on public.comments for update to authenticated using ((( select auth.uid() as uid) = author_id)) with check ((( select auth.uid() as uid) = author_id));",
      "08_pk.sql":
        "alter table public.comments add constraint comments_pkey primary key (id);",
      "09_fk_parent.sql":
        "alter table public.comments add constraint comments_parent_id_fkey foreign key (parent_id) references public.comments(id) on delete cascade;",
      "10_index_author.sql":
        "create index idx_comments_author_id on public.comments (author_id);",
    });

    const result = await analyzeAndSortFromRandomizedStatements({
      roots: [root],
      seed: 47,
    });
    const validation = await validateAnalyzeResultWithPostgres(result, {
      initialMigrationSql: `
          create extension if not exists pgcrypto;
          do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
          create schema if not exists auth;
          create or replace function auth.uid() returns uuid language sql stable as $$ select gen_random_uuid() $$;
          create or replace function public.update_updated_at_column() returns trigger language plpgsql as $$
          begin
            new.updated_at = now();
            return new;
          end;
          $$;
          create table if not exists public.comment_likes (
            id uuid default gen_random_uuid() not null,
            comment_id uuid not null
          );
        `,
    });

    const executionErrors = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );
    const assumedExternal = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
    );

    expect(executionErrors).toHaveLength(0);
    expect(assumedExternal).toHaveLength(0);
  }, 120000);
});
