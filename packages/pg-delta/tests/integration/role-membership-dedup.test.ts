/**
 * Integration tests for role membership deduplication.
 *
 * In PostgreSQL 16+, pg_auth_members can have multiple rows for the same
 * (roleid, member) pair with different grantors. This test verifies that
 * the diff engine correctly deduplicates these memberships and does not
 * produce duplicate GRANT statements.
 */

import { describe, expect, test } from "bun:test";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`role membership dedup (pg${pgVersion})`, () => {
    // PG 16+ supports multiple grantors for the same role-member pair
    if (pgVersion >= 16) {
      test(
        "no duplicate GRANT when membership has multiple grantors",
        withDbIsolated(pgVersion, async (db) => {
          // On the branch: create a role membership that will have two rows
          // in pg_auth_members due to being granted by different grantors.
          //
          // 1. Create an admin role with CREATEROLE
          // 2. Create a parent role and a child role
          // 3. Grant the admin role membership of parent_role WITH ADMIN OPTION
          //    (so it can then grant it to others)
          // 4. Have the superuser (postgres) grant the membership to child
          // 5. Have the admin role also grant the membership to child
          // This creates two pg_auth_members rows for the same (parent, child) pair.
          await db.branch.query(`
            CREATE ROLE admin_grantor WITH CREATEROLE;
            CREATE ROLE parent_role;
            CREATE ROLE child_role;

            -- Give admin_grantor the ability to grant parent_role
            GRANT parent_role TO admin_grantor WITH ADMIN OPTION;

            -- First grant: by postgres (superuser/default)
            GRANT parent_role TO child_role;

            -- Second grant: by admin_grantor (creates a second pg_auth_members row)
            SET ROLE admin_grantor;
            GRANT parent_role TO child_role;
            RESET ROLE;
          `);

          // Extract the branch catalog and verify the role has deduplicated members
          const branchCatalog = await extractCatalog(db.branch);
          const parentRole = Object.values(branchCatalog.roles).find(
            (r) => r.name === "parent_role",
          );
          expect(parentRole).toBeDefined();
          // child_role and admin_grantor are members, but child_role should not
          // be duplicated despite having two grantors
          const childMembers = parentRole?.members.filter(
            (m) => m.member === "child_role",
          );
          expect(childMembers).toHaveLength(1);

          // Now create a plan from empty main to branch with the roles
          // The plan should contain exactly one GRANT for child_role -> parent_role
          const result = await createPlan(db.main, db.branch);
          expect(result).not.toBeNull();

          const grantStatements = result?.plan.statements.filter(
            (s) =>
              s.includes("GRANT parent_role TO child_role") &&
              !s.startsWith("REVOKE"),
          );
          expect(grantStatements).toHaveLength(1);
        }),
      );

      test(
        "no diff when both sides have same membership from different grantors",
        withDbIsolated(pgVersion, async (db) => {
          // Setup: same role structure on both main and branch
          const setup = `
            CREATE ROLE admin_grantor WITH CREATEROLE;
            CREATE ROLE parent_role;
            CREATE ROLE child_role;

            -- Give admin_grantor the ability to grant parent_role
            GRANT parent_role TO admin_grantor WITH ADMIN OPTION;
          `;

          await db.main.query(setup);
          await db.branch.query(setup);

          // Main: grant by postgres only
          await db.main.query(`
            GRANT parent_role TO child_role;
          `);

          // Branch: grant by both postgres and admin_grantor
          await db.branch.query(`
            GRANT parent_role TO child_role;
            SET ROLE admin_grantor;
            GRANT parent_role TO child_role;
            RESET ROLE;
          `);

          // Plan should have no changes for the parent_role -> child_role
          // membership because both sides have the same effective membership
          // after deduplication
          const result = await createPlan(db.main, db.branch);
          if (result !== null) {
            const parentChildGrants = result.plan.statements.filter(
              (s) => s.includes("parent_role") && s.includes("child_role"),
            );
            expect(parentChildGrants).toHaveLength(0);
          }
        }),
      );
    }
  });
}
