/**
 * Integration tests for PostgreSQL policy dependencies.
 */

import { describe, expect, test } from "bun:test";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  // TODO: Fix policy dependency detection issues
  describe(`policy dependencies (pg${pgVersion})`, () => {
    test(
      "policy depends on table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA security;
          CREATE TABLE security.users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT UNIQUE
          );
        `,
          testSql: `
          ALTER TABLE security.users ENABLE ROW LEVEL SECURITY;
          CREATE POLICY user_isolation ON security.users
            FOR ALL
            TO public
            USING (true);
        `,
        });
      }),
    );

    test(
      "multiple policies with dependencies",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA app;
          CREATE TABLE app.posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            author_id INTEGER NOT NULL,
            published BOOLEAN DEFAULT false
          );
        `,
          testSql: `
          ALTER TABLE app.posts ENABLE ROW LEVEL SECURITY;

          -- Read policy for all users
          CREATE POLICY read_posts ON app.posts
            FOR SELECT
            TO public
            USING (published = true);

          -- Insert policy for authenticated users
          CREATE POLICY insert_own_posts ON app.posts
            FOR INSERT
            TO public
            WITH CHECK (true);

          -- Update policy for authors
          CREATE POLICY update_own_posts ON app.posts
            FOR UPDATE
            TO public
            USING (true)
            WITH CHECK (true);
        `,
        });
      }),
    );

    test(
      "create table and policy together",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA tenant;
        `,
          testSql: `
          CREATE TABLE tenant.data (
            id INTEGER PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_by INTEGER
          );

          ALTER TABLE tenant.data ENABLE ROW LEVEL SECURITY;

          CREATE POLICY tenant_isolation ON tenant.data
            FOR ALL
            TO public
            USING (true)
            WITH CHECK (true);
        `,
        });
      }),
    );

    test(
      "policy USING expression references another new table (EXISTS)",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA app;
        `,
          testSql: `
          CREATE TABLE app.accounts (
            id INTEGER PRIMARY KEY
          );

          CREATE TABLE app.users (
            id INTEGER PRIMARY KEY
          );

          ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;

          CREATE POLICY account_access ON app.accounts
            FOR SELECT
            TO public
            USING (EXISTS (SELECT 1 FROM app.users));
        `,
          assertSqlStatements: (statements) => {
            const createUsersIdx = statements.findIndex((s) =>
              s.includes("CREATE TABLE app.users"),
            );
            const createPolicyIdx = statements.findIndex((s) =>
              s.includes("CREATE POLICY account_access"),
            );
            expect(createUsersIdx).toBeGreaterThanOrEqual(0);
            expect(createPolicyIdx).toBeGreaterThanOrEqual(0);
            expect(createUsersIdx).toBeLessThan(createPolicyIdx);
          },
        });
      }),
    );

    test(
      "policy expression references multiple new tables via IN (SELECT …)",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA app;
        `,
          testSql: `
          CREATE TABLE app.accounts (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL
          );

          CREATE TABLE app.memberships (
            account_id INTEGER PRIMARY KEY,
            active BOOLEAN NOT NULL
          );

          CREATE TABLE app.statuses (
            status TEXT PRIMARY KEY
          );

          ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;

          CREATE POLICY account_access ON app.accounts
            FOR SELECT
            TO public
            USING (
              id IN (SELECT account_id FROM app.memberships WHERE active)
              AND status IN (SELECT status FROM app.statuses)
            );
        `,
          assertSqlStatements: (statements) => {
            const createMembershipsIdx = statements.findIndex((s) =>
              s.includes("CREATE TABLE app.memberships"),
            );
            const createStatusesIdx = statements.findIndex((s) =>
              s.includes("CREATE TABLE app.statuses"),
            );
            const createPolicyIdx = statements.findIndex((s) =>
              s.includes("CREATE POLICY account_access"),
            );
            expect(createMembershipsIdx).toBeGreaterThanOrEqual(0);
            expect(createStatusesIdx).toBeGreaterThanOrEqual(0);
            expect(createPolicyIdx).toBeGreaterThanOrEqual(0);
            expect(createMembershipsIdx).toBeLessThan(createPolicyIdx);
            expect(createStatusesIdx).toBeLessThan(createPolicyIdx);
          },
        });
      }),
    );

    test(
      "policy USING expression calls a new function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA app;
        `,
          testSql: `
          CREATE TABLE app.accounts (
            id INTEGER PRIMARY KEY
          );

          CREATE FUNCTION app.is_admin() RETURNS BOOLEAN
            LANGUAGE sql
            STABLE
            AS $$ SELECT true $$;

          ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;

          CREATE POLICY account_access ON app.accounts
            FOR SELECT
            TO public
            USING (app.is_admin());
        `,
          assertSqlStatements: (statements) => {
            const createFunctionIdx = statements.findIndex((s) =>
              s.includes("FUNCTION app.is_admin"),
            );
            const createPolicyIdx = statements.findIndex((s) =>
              s.includes("CREATE POLICY account_access"),
            );
            expect(createFunctionIdx).toBeGreaterThanOrEqual(0);
            expect(createPolicyIdx).toBeGreaterThanOrEqual(0);
            expect(createFunctionIdx).toBeLessThan(createPolicyIdx);
          },
        });
      }),
    );

    test(
      "policy expression references a new view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA app;
        `,
          testSql: `
          CREATE TABLE app.accounts (
            id INTEGER PRIMARY KEY,
            active BOOLEAN NOT NULL
          );

          CREATE VIEW app.active_accounts AS
            SELECT id FROM app.accounts WHERE active;

          ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;

          CREATE POLICY account_access ON app.accounts
            FOR SELECT
            TO public
            USING (id IN (SELECT id FROM app.active_accounts));
        `,
          assertSqlStatements: (statements) => {
            const createViewIdx = statements.findIndex((s) =>
              s.includes("CREATE VIEW app.active_accounts"),
            );
            const createPolicyIdx = statements.findIndex((s) =>
              s.includes("CREATE POLICY account_access"),
            );
            expect(createViewIdx).toBeGreaterThanOrEqual(0);
            expect(createPolicyIdx).toBeGreaterThanOrEqual(0);
            expect(createViewIdx).toBeLessThan(createPolicyIdx);
          },
        });
      }),
    );

    test(
      "policy depending on a replaced function is dropped and recreated",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE TABLE public.alter_function_sign_policy_dependent_profiles (
            id uuid PRIMARY KEY,
            role text
          );

          ALTER TABLE public.alter_function_sign_policy_dependent_profiles ENABLE ROW LEVEL SECURITY;

          CREATE OR REPLACE FUNCTION public.alter_function_sign_policy_dependent_check_role(
            _id uuid, _role text
          ) RETURNS boolean AS $$
          BEGIN RETURN true; END;
          $$ LANGUAGE plpgsql;

          CREATE POLICY alter_function_sign_policy_dependent_check_role_policy
            ON public.alter_function_sign_policy_dependent_profiles
            FOR SELECT USING (
              public.alter_function_sign_policy_dependent_check_role(id, role)
            );
        `,
          testSql: `
          DROP POLICY alter_function_sign_policy_dependent_check_role_policy
            ON public.alter_function_sign_policy_dependent_profiles;

          DROP FUNCTION public.alter_function_sign_policy_dependent_check_role(uuid, text);

          CREATE OR REPLACE FUNCTION public.alter_function_sign_policy_dependent_check_role(
            _id uuid, _role text, _extra text DEFAULT 'default'::text
          ) RETURNS boolean AS $$
          BEGIN RETURN true; END;
          $$ LANGUAGE plpgsql;

          CREATE POLICY alter_function_sign_policy_dependent_check_role_policy
            ON public.alter_function_sign_policy_dependent_profiles
            FOR SELECT USING (
              public.alter_function_sign_policy_dependent_check_role(id, role)
            );
        `,
          assertSqlStatements: (statements) => {
            const dropPolicyIdx = statements.findIndex((s) =>
              s.includes(
                "DROP POLICY alter_function_sign_policy_dependent_check_role_policy",
              ),
            );
            const dropFunctionIdx = statements.findIndex((s) =>
              s.includes(
                "DROP FUNCTION public.alter_function_sign_policy_dependent_check_role",
              ),
            );
            const createFunctionIdx = statements.findIndex((s) =>
              s.includes(
                "CREATE FUNCTION public.alter_function_sign_policy_dependent_check_role",
              ),
            );
            const createPolicyIdx = statements.findIndex((s) =>
              s.includes(
                "CREATE POLICY alter_function_sign_policy_dependent_check_role_policy",
              ),
            );

            expect(dropPolicyIdx).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIdx).toBeGreaterThanOrEqual(0);
            expect(createFunctionIdx).toBeGreaterThanOrEqual(0);
            expect(createPolicyIdx).toBeGreaterThanOrEqual(0);
            expect(dropPolicyIdx).toBeLessThan(dropFunctionIdx);
            expect(createFunctionIdx).toBeLessThan(createPolicyIdx);
          },
        });
      }),
    );

    test(
      "policy depending on a column type rewrite is dropped and recreated",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE TYPE public.user_role_enum AS ENUM ('admin', 'user', 'guest');

          CREATE TABLE public.solution_categories_with_policy (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            role text NOT NULL
          );

          ALTER TABLE public.solution_categories_with_policy ENABLE ROW LEVEL SECURITY;

          CREATE POLICY "categories_admin_manage" ON public.solution_categories_with_policy
            FOR ALL
            TO public
            USING (role = 'admin')
            WITH CHECK (role = 'admin');
        `,
          testSql: `
          DROP POLICY "categories_admin_manage" ON public.solution_categories_with_policy;

          ALTER TABLE public.solution_categories_with_policy
            ALTER COLUMN role TYPE public.user_role_enum USING role::public.user_role_enum;

          CREATE POLICY "categories_admin_manage" ON public.solution_categories_with_policy
            FOR ALL TO public
            USING (role = 'admin'::public.user_role_enum)
            WITH CHECK (role = 'admin'::public.user_role_enum);
        `,
          assertSqlStatements: (statements) => {
            expect(statements.join(";\n")).toMatchInlineSnapshot(`
              "DROP POLICY categories_admin_manage ON public.solution_categories_with_policy;
              ALTER TABLE public.solution_categories_with_policy ALTER COLUMN role TYPE user_role_enum USING role::user_role_enum;
              CREATE POLICY categories_admin_manage ON public.solution_categories_with_policy USING ((role = 'admin'::user_role_enum)) WITH CHECK ((role = 'admin'::user_role_enum))"
            `);
          },
        });
      }),
    );
  });
}
