/**
 * Integration tests for role-level GUC (pg_db_role_setting) diffing.
 *
 * Regression coverage for CLI-343: commands of the form
 *   ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true';
 * live in pg_db_role_setting and must be captured by the diff tool via the
 * role `config` catalog field + `AlterRoleSetConfig` change.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`role config GUC (pg${pgVersion})`, () => {
    test(
      "diff captures ALTER ROLE ... SET pgrst.db_aggregates_enabled",
      withDbIsolated(pgVersion, async (db) => {
        // Same role on both sides; branch has the pgrst GUC set.
        const setup = `
          CREATE ROLE authenticator WITH NOLOGIN NOINHERIT;
        `;
        await db.main.query(setup);
        await db.branch.query(setup);
        await db.branch.query(
          `ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true'`,
        );

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        // biome-ignore lint/style/noNonNullAssertion: guarded above
        const statements = result!.plan.statements;

        const setStatements = statements.filter((s) =>
          s.includes("pgrst.db_aggregates_enabled"),
        );
        expect(setStatements).toHaveLength(1);
        expect(setStatements[0]).toBe(
          "ALTER ROLE authenticator SET pgrst.db_aggregates_enabled TO true",
        );

        // Apply the plan and verify the catalog lines up.
        const script = statements.join(";\n");
        await expect(
          db.main.query(script.endsWith(";") ? script : `${script};`),
        ).resolves.toBeDefined();

        const replay = await createPlan(db.main, db.branch);
        expect(replay).toBeNull();
      }),
    );

    test(
      "diff emits RESET for removed setting and SET for added one",
      withDbIsolated(pgVersion, async (db) => {
        const setup = `
          CREATE ROLE api_role WITH NOLOGIN NOINHERIT;
        `;
        await db.main.query(setup);
        await db.branch.query(setup);
        // Main has statement_timeout; branch has lock_timeout instead.
        await db.main.query(`ALTER ROLE api_role SET statement_timeout = '3s'`);
        await db.branch.query(`ALTER ROLE api_role SET lock_timeout = '5s'`);

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        // biome-ignore lint/style/noNonNullAssertion: guarded above
        const statements = result!.plan.statements;

        const resetStatements = statements.filter(
          (s) => s === "ALTER ROLE api_role RESET statement_timeout",
        );
        const setStatements = statements.filter(
          (s) => s === "ALTER ROLE api_role SET lock_timeout TO '5s'",
        );
        expect(resetStatements).toHaveLength(1);
        expect(setStatements).toHaveLength(1);
      }),
    );
  });
}
