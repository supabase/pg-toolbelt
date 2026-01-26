/**
 * Integration tests for the role option in createPlan.
 * Verifies that SET ROLE is properly applied on pool connections.
 */

import { describe, expect } from "vitest";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`role option (pg${pgVersion})`, () => {
    test("plan contains SET ROLE when role option is provided", async ({
      db,
    }) => {
      // Setup: create a schema in branch only
      await db.branch.query("CREATE SCHEMA test_schema");

      // Create plan with role option
      const result = await createPlan(db.main, db.branch, {
        role: "test_role",
      });

      expect(result).not.toBeNull();
      expect(result?.plan.statements[0]).toBe('SET ROLE "test_role"');
      expect(result?.plan.role).toBe("test_role");
    });

    testIsolated("extraction uses the specified role", async ({ db }) => {
      // Create a role (cluster-level, shared between both databases)
      // Use DO block to handle "role already exists" gracefully
      await db.main.query(`
        CREATE ROLE extraction_test_role WITH NOLOGIN;
        CREATE SCHEMA test_schema;
        GRANT USAGE ON SCHEMA test_schema TO extraction_test_role;
        GRANT CREATE ON SCHEMA test_schema TO extraction_test_role;
      `);
      await db.branch.query(`
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
    });
  });
}
