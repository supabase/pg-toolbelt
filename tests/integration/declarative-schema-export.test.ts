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

    test("foreign key constraints in foreign_keys/", async ({ db }) => {
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

      const fkFile = output.files.find(
        (file) =>
          file.path.includes("foreign_keys/") &&
          file.sql.includes("REFERENCES") &&
          file.sql.includes("test_schema.users"),
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

  describe.sequential(
    `declarative schema export - simple mode (pg${pgVersion})`,
    () => {
      const simpleOpts = { mode: "simple" as const };

      test("flat file structure for tables", async ({ db }) => {
        const output = await testDeclarativeExport({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
            CREATE TABLE test_schema.users (
              id integer PRIMARY KEY,
              name text NOT NULL
            );
            CREATE TABLE test_schema.posts (
              id integer PRIMARY KEY,
              title text
            );
          `,
          exportOptions: simpleOpts,
        });

        // All tables should be in the combined tables_and_functions.sql file
        const tableFiles = output.files.filter(
          (f) => f.path === "tables_and_functions.sql",
        );
        expect(tableFiles).toHaveLength(1);
        expect(tableFiles[0].sql).toContain("test_schema.users");
        expect(tableFiles[0].sql).toContain("test_schema.posts");

        // No nested directory paths
        for (const file of output.files) {
          expect(file.path).not.toContain("/");
        }
      });

      test("schemas and extensions in flat files", async ({ db }) => {
        const output = await testDeclarativeExport({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
            CREATE SCHEMA schema_c;
            CREATE SCHEMA schema_d;
            CREATE EXTENSION IF NOT EXISTS pg_trgm;
          `,
          exportOptions: simpleOpts,
        });

        const schemaFile = output.files.find(
          (f) => f.path === "schemas.sql",
        );
        expect(schemaFile).toBeDefined();
        expect(schemaFile?.sql).toContain("schema_c");
        expect(schemaFile?.sql).toContain("schema_d");

        const extFile = output.files.find(
          (f) => f.path === "extensions.sql",
        );
        expect(extFile).toBeDefined();
        expect(extFile?.sql).toContain("pg_trgm");
      });

      test("tables, views, and functions in combined file", async ({ db }) => {
        const output = await testDeclarativeExport({
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
          exportOptions: simpleOpts,
        });

        // Tables, views, and functions all go into the combined file
        const combined = output.files.find(
          (f) => f.path === "tables_and_functions.sql",
        );
        expect(combined).toBeDefined();
        expect(combined?.sql).toContain("test_schema.users");
        expect(combined?.sql).toContain("user_view");
        expect(combined?.sql).toContain("get_users");

        // No nested paths
        for (const file of output.files) {
          expect(file.path).not.toContain("/");
        }
      });

      test("foreign keys in foreign_keys.sql", async ({ db }) => {
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
          exportOptions: simpleOpts,
        });

        const fkFile = output.files.find(
          (f) => f.path === "foreign_keys.sql",
        );
        expect(fkFile).toBeDefined();
        expect(fkFile?.sql).toContain("REFERENCES");
        expect(fkFile?.sql).toContain("test_schema.users");

        // FK should not be in the tables_and_functions.sql file
        const tableFile = output.files.find(
          (f) => f.path === "tables_and_functions.sql",
        );
        if (tableFile) {
          expect(tableFile.sql).not.toContain("REFERENCES");
        }
      });

      test("triggers in triggers.sql", async ({ db }) => {
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
          exportOptions: simpleOpts,
        });

        const triggerFile = output.files.find(
          (f) => f.path === "triggers.sql",
        );
        expect(triggerFile).toBeDefined();
        expect(triggerFile?.sql).toContain("CREATE TRIGGER");
        expect(triggerFile?.sql).toContain("users_trigger");

        // Combined file should come before triggers file
        const combinedIdx = output.files.findIndex(
          (f) => f.path === "tables_and_functions.sql",
        );
        const triggerIdx = output.files.findIndex(
          (f) => f.path === "triggers.sql",
        );
        expect(combinedIdx).toBeGreaterThanOrEqual(0);
        expect(triggerIdx).toBeGreaterThanOrEqual(0);
        expect(combinedIdx).toBeLessThan(triggerIdx);
      });

      test("RLS policies in policies.sql", async ({ db }) => {
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
          exportOptions: simpleOpts,
        });

        const policyFile = output.files.find(
          (f) => f.path === "policies.sql",
        );
        expect(policyFile).toBeDefined();
        expect(policyFile?.sql).toContain("CREATE POLICY");
        expect(policyFile?.sql).toContain("user_policy");

        // Combined file should come before policies
        const tableIdx = output.files.findIndex(
          (f) => f.path === "tables_and_functions.sql",
        );
        const policyIdx = output.files.findIndex(
          (f) => f.path === "policies.sql",
        );
        expect(tableIdx).toBeGreaterThanOrEqual(0);
        expect(policyIdx).toBeGreaterThanOrEqual(0);
        expect(tableIdx).toBeLessThan(policyIdx);
      });

      test("orderPrefix with simple mode", async ({ db }) => {
        const output = await testDeclarativeExport({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
            CREATE TABLE test_schema.users (id integer, name text);
            CREATE VIEW test_schema.user_view AS
              SELECT * FROM test_schema.users;
          `,
          exportOptions: { ...simpleOpts, orderPrefix: true },
        });

        // All paths should have a numeric prefix
        for (const file of output.files) {
          expect(file.path).toMatch(/^\d{6}_/);
        }

        // Paths after prefix should be flat
        for (const file of output.files) {
          const afterPrefix = file.path.replace(/^\d{6}_/, "");
          expect(afterPrefix).not.toContain("/");
        }
      });

      test("multiple schemas merged into flat files", async ({ db }) => {
        const output = await testDeclarativeExport({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
            CREATE SCHEMA schema_a;
            CREATE SCHEMA schema_b;
            CREATE TABLE schema_a.table1 (id integer);
            CREATE TABLE schema_b.table2 (id integer);
          `,
          exportOptions: simpleOpts,
        });

        // Both schemas in one file
        const schemaFile = output.files.find(
          (f) => f.path === "schemas.sql",
        );
        expect(schemaFile).toBeDefined();
        expect(schemaFile?.sql).toContain("schema_a");
        expect(schemaFile?.sql).toContain("schema_b");

        // Both tables in combined file
        const tableFile = output.files.find(
          (f) => f.path === "tables_and_functions.sql",
        );
        expect(tableFile).toBeDefined();
        expect(tableFile?.sql).toContain("schema_a.table1");
        expect(tableFile?.sql).toContain("schema_b.table2");
      });
    },
  );
}
