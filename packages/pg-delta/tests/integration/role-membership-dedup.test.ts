/**
 * Integration tests for role membership deduplication and self-grant handling.
 *
 * In PostgreSQL 16+, pg_auth_members can have multiple rows for the same
 * (roleid, member) pair with different grantors. This test verifies that
 * the diff engine correctly deduplicates these memberships and does not
 * produce duplicate GRANT statements.
 *
 * Additionally, PostgreSQL 17+ rejects GRANT ... WITH ADMIN OPTION when
 * the grantee is the same as the grantor of the existing membership.
 * Self-granted memberships (member === grantor) are auto-created by
 * CREATE ROLE and must be skipped in diff output.
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
          expect(result?.plan.statements).toMatchInlineSnapshot(`
            [
              "CREATE ROLE admin_grantor WITH CREATEROLE",
              "CREATE ROLE child_role",
              "CREATE ROLE parent_role",
              "GRANT parent_role TO admin_grantor WITH ADMIN OPTION",
              "GRANT parent_role TO child_role",
            ]
          `);
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
          // after deduplication. The plan may be null (no changes at all) or
          // non-null with unrelated changes — either way, there should be no
          // GRANT/REVOKE for parent_role TO/FROM child_role.
          const result = await createPlan(db.main, db.branch);
          expect(result).toBeNull();
        }),
      );
    }
  });

  describe(`role self-grant skip (pg${pgVersion})`, () => {
    test(
      "GRANT role TO postgres WITH ADMIN OPTION is skipped for creator-granted membership",
      withDbIsolated(pgVersion, async (db) => {
        // Create a role on branch only. When postgres creates a role, PG
        // automatically adds a pg_auth_members row where postgres is both
        // the member and the grantor (with admin_option=true on PG 16+).
        // The diff should NOT emit "GRANT developer TO postgres WITH ADMIN OPTION"
        // because that would fail with:
        //   ERROR: ADMIN option cannot be granted back to your own grantor
        await db.branch.query(`
          CREATE ROLE developer;
        `);

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        const statements = result!.plan.statements;

        // Should contain CREATE ROLE but NOT any GRANT to postgres
        expect(statements).toContain("CREATE ROLE developer");
        const grantToPostgres = statements.filter(
          (s) => s.includes("GRANT developer TO postgres"),
        );
        expect(grantToPostgres).toHaveLength(0);

        // Verify the plan can actually be applied without errors
        // (this is the core of the bug: the SQL must run as postgres)
        const script = `${statements.join(";\n")};`;
        await expect(db.main.query(script)).resolves.toBeDefined();
      }),
    );

    test(
      "GRANT role TO child_role works when child_role is not the grantor",
      withDbIsolated(pgVersion, async (db) => {
        // Normal case: granting a role to a different user should work fine
        await db.branch.query(`
          CREATE ROLE parent_role;
          CREATE ROLE child_role;
          GRANT parent_role TO child_role;
        `);

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        const statements = result!.plan.statements;

        // Should contain both CREATE ROLEs and the GRANT
        expect(statements).toContain("CREATE ROLE child_role");
        expect(statements).toContain("CREATE ROLE parent_role");
        const grantStatements = statements.filter((s) =>
          s.includes("GRANT parent_role TO child_role"),
        );
        expect(grantStatements).toHaveLength(1);

        // Verify the plan can be applied
        const script = `${statements.join(";\n")};`;
        await expect(db.main.query(script)).resolves.toBeDefined();
      }),
    );

    test(
      "role with admin option to non-self member works correctly",
      withDbIsolated(pgVersion, async (db) => {
        // Grant with admin option to a non-self member should be emitted
        await db.branch.query(`
          CREATE ROLE parent_role;
          CREATE ROLE child_role;
          GRANT parent_role TO child_role WITH ADMIN OPTION;
        `);

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        const statements = result!.plan.statements;

        // Should contain GRANT WITH ADMIN OPTION
        const grantStatements = statements.filter((s) =>
          s.includes("GRANT parent_role TO child_role WITH ADMIN OPTION"),
        );
        expect(grantStatements).toHaveLength(1);

        // Verify the plan can be applied
        const script = `${statements.join(";\n")};`;
        await expect(db.main.query(script)).resolves.toBeDefined();
      }),
    );
  });
}
