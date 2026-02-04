import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { testDeclarativeExport } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.sequential(`declarative schema export (pg${pgVersion})`, () => {
    test("simple table", async ({ db }) => {
      await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL
          );
        `,
      });
    });

    test("table with index", async ({ db }) => {
      await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL
          );
          CREATE INDEX users_name_idx ON test_schema.users (name);
        `,
      });
    });

    test("multiple schemas", async ({ db }) => {
      await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE SCHEMA schema_a;
          CREATE SCHEMA schema_b;
          CREATE TABLE schema_a.table1 (id integer);
          CREATE TABLE schema_b.table2 (id integer);
        `,
      });
    });

    test("roles and extensions", async ({ db }) => {
      await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: `
          CREATE ROLE test_role;
          CREATE EXTENSION IF NOT EXISTS pg_trgm;
        `,
      });
    });

    test("views and functions", async ({ db }) => {
      await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (id integer, name text);
          CREATE VIEW test_schema.user_view AS
            SELECT * FROM test_schema.users;
          CREATE FUNCTION test_schema.get_users()
            RETURNS SETOF test_schema.users
            AS $$ SELECT * FROM test_schema.users; $$
            LANGUAGE sql;
        `,
      });
    });

    test("foreign key constraints in policies/", async ({ db }) => {
      const output = await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (id integer PRIMARY KEY);
          CREATE TABLE test_schema.posts (
            id integer PRIMARY KEY,
            user_id integer REFERENCES test_schema.users(id)
          );
        `,
      });

      const fkFile = output.files.find((file) =>
        file.path.includes("policies/posts.sql"),
      );
      expect(fkFile).toBeDefined();
      expect(fkFile?.sql).toContain("REFERENCES");
      expect(fkFile?.sql).toContain("test_schema.users");

      const tableFile = output.files.find((file) =>
        file.path.includes("tables/posts.sql"),
      );
      if (tableFile) {
        expect(tableFile.sql).not.toContain("REFERENCES");
      }
    });

    test("triggers in policies/", async ({ db }) => {
      const output = await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (id integer);
          CREATE FUNCTION test_schema.trigger_fn() RETURNS trigger
            AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
          CREATE TRIGGER users_trigger
            BEFORE INSERT ON test_schema.users
            FOR EACH ROW EXECUTE FUNCTION test_schema.trigger_fn();
        `,
      });

      const triggerFile = output.files.find((file) =>
        file.path.includes("policies/users.sql"),
      );
      expect(triggerFile).toBeDefined();
      expect(triggerFile?.sql).toContain("CREATE TRIGGER");
      expect(triggerFile?.sql).toContain("users_trigger");

      const functionFileIdx = output.files.findIndex((file) =>
        file.path.includes("functions/"),
      );
      const policyFileIdx = output.files.findIndex((file) =>
        file.path.includes("policies/"),
      );
      expect(functionFileIdx).toBeGreaterThanOrEqual(0);
      expect(policyFileIdx).toBeGreaterThanOrEqual(0);
      expect(functionFileIdx).toBeLessThan(policyFileIdx);
    });

    test("RLS policies in policies/", async ({ db }) => {
      const output = await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (id integer, owner_id integer);
          ALTER TABLE test_schema.users ENABLE ROW LEVEL SECURITY;
          CREATE POLICY user_policy ON test_schema.users
            FOR SELECT USING (owner_id = current_setting('app.user_id')::integer);
        `,
      });

      const policyFile = output.files.find((file) =>
        file.path.includes("policies/users.sql"),
      );
      expect(policyFile).toBeDefined();
      expect(policyFile?.sql).toContain("CREATE POLICY");
      expect(policyFile?.sql).toContain("user_policy");

      const tableFileIdx = output.files.findIndex((file) =>
        file.path.includes("tables/users.sql"),
      );
      const policyFileIdx = output.files.findIndex((file) =>
        file.path.includes("policies/users.sql"),
      );
      expect(tableFileIdx).toBeGreaterThanOrEqual(0);
      expect(policyFileIdx).toBeGreaterThanOrEqual(0);
      expect(tableFileIdx).toBeLessThan(policyFileIdx);
    });

    test("partitioned tables", async ({ db }) => {
      const output = await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.measurements (
            id integer,
            date date
          ) PARTITION BY RANGE (date);
          CREATE TABLE test_schema.measurements_2024
            PARTITION OF test_schema.measurements
            FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        `,
      });

      const parentFile = output.files.find((file) =>
        file.path.includes("tables/measurements.sql"),
      );
      const partitionFile = output.files.find((file) =>
        file.path.includes("tables/measurements_2024.sql"),
      );
      expect(parentFile).toBeDefined();
      expect(partitionFile).toBeDefined();

      const parentIdx = output.files.indexOf(parentFile!);
      const partitionIdx = output.files.indexOf(partitionFile!);
      expect(parentIdx).toBeLessThan(partitionIdx);
      expect(partitionFile?.sql).toContain("PARTITION OF");
      expect(partitionFile?.sql).toContain("test_schema.measurements");
    });

    test("materialized views with indexes", async ({ db }) => {
      const output = await testDeclarativeExport({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: "CREATE SCHEMA test_schema;",
        testSql: `
          CREATE TABLE test_schema.users (id integer, name text);
          CREATE MATERIALIZED VIEW test_schema.user_summary AS
            SELECT * FROM test_schema.users;
          CREATE INDEX user_summary_idx ON test_schema.user_summary (id);
        `,
      });

      const tableFileIdx = output.files.findIndex((file) =>
        file.path.includes("tables/users.sql"),
      );
      const viewFileIdx = output.files.findIndex((file) =>
        file.path.includes("matviews/user_summary.sql"),
      );
      const indexFile = output.files.find((file) =>
        file.path.includes("indexes/user_summary_idx.sql"),
      );

      expect(tableFileIdx).toBeGreaterThanOrEqual(0);
      expect(viewFileIdx).toBeGreaterThanOrEqual(0);
      expect(indexFile).toBeDefined();
      expect(tableFileIdx).toBeLessThan(viewFileIdx);

      const indexIdx = output.files.indexOf(indexFile!);
      expect(viewFileIdx).toBeLessThan(indexIdx);
      expect(indexFile?.sql).toContain("user_summary_idx");
    });
  });
}
