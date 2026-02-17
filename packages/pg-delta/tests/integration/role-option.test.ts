/**
 * Integration tests for the role option in createPlan.
 * Verifies that SET ROLE is properly applied on pool connections.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`role option (pg${pgVersion})`, () => {
    test(
      "plan contains SET ROLE when role option is provided",
      withDb(pgVersion, async (db) => {
        // Setup: create a schema in branch only
        await db.branch.query("CREATE SCHEMA test_schema");

        // Create plan with role option
        const result = await createPlan(db.main, db.branch, {
          role: "test_role",
        });

        expect(result).not.toBeNull();
        expect(result?.plan.statements[0]).toBe('SET ROLE "test_role"');
        expect(result?.plan.role).toBe("test_role");
      }),
    );

    test(
      "extraction uses the specified role",
      withDbIsolated(pgVersion, async (db) => {
        // Create a role on both containers (isolated containers don't share roles)
        await db.main.query(`
        CREATE ROLE extraction_test_role WITH NOLOGIN;
        CREATE SCHEMA test_schema;
        GRANT USAGE ON SCHEMA test_schema TO extraction_test_role;
        GRANT CREATE ON SCHEMA test_schema TO extraction_test_role;
      `);
        await db.branch.query(`
        CREATE ROLE extraction_test_role WITH NOLOGIN;
        CREATE SCHEMA test_schema;
        GRANT USAGE ON SCHEMA test_schema TO extraction_test_role;
        GRANT CREATE ON SCHEMA test_schema TO extraction_test_role;
      `);

        // Create a table in branch as the test role
        await db.branch.query(`
        SET ROLE extraction_test_role;
        CREATE TABLE test_schema.role_owned_table (id integer);
        RESET ROLE;
      `);

        // Create plan with role option - should see the table owned by the role
        const result = await createPlan(db.main, db.branch, {
          role: "extraction_test_role",
        });

        expect(result).not.toBeNull();
        // The plan should include creating the table
        const createTableStatement = result?.plan.statements.find((s) =>
          s.includes("CREATE TABLE"),
        );
        expect(createTableStatement).toBeDefined();
        expect(createTableStatement).toContain("test_schema");
        expect(createTableStatement).toContain("role_owned_table");
      }),
    );
  });
}
