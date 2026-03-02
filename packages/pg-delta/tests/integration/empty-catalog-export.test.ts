import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`empty catalog export (pg${pgVersion})`, () => {
    test(
      "single-database export produces CREATE statements for all objects",
      withDb(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.users (
            id serial PRIMARY KEY,
            name text NOT NULL
          );
          CREATE TABLE app.posts (
            id serial PRIMARY KEY,
            user_id int REFERENCES app.users(id),
            title text NOT NULL
          );
        `);

        // Pool input → falls back to createEmptyCatalog (static baseline)
        const result = await createPlan(null, db.branch);
        expect(result).not.toBeNull();
        if (result === null) throw new Error("unreachable");

        const statementsText = result.plan.statements.join("\n");
        expect(statementsText).toContain("CREATE SCHEMA app");
        expect(statementsText).toContain("CREATE TABLE app.users");
        expect(statementsText).toContain("CREATE TABLE app.posts");

        const createOps = result.sortedChanges.filter(
          (c) => c.operation === "create",
        );
        expect(createOps.length).toBeGreaterThan(0);

        const dropOps = result.sortedChanges.filter(
          (c) => c.operation === "drop",
        );
        expect(dropOps).toHaveLength(0);
      }),
    );

    test(
      "single-database export does not emit CREATE SCHEMA public",
      withDb(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE TABLE public.items (id serial PRIMARY KEY);
        `);

        // Pool input → falls back to createEmptyCatalog (has public pre-populated)
        const result = await createPlan(null, db.branch);
        expect(result).not.toBeNull();
        if (result === null) throw new Error("unreachable");

        const createSchemaPublic = result.plan.statements.filter((s) =>
          /CREATE SCHEMA.*public/i.test(s),
        );
        expect(createSchemaPublic).toHaveLength(0);
      }),
    );

    test(
      "single-database export captures all user-created objects (Pool fallback)",
      withDbIsolated(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.config (key text PRIMARY KEY, value text);
        `);

        // Pool inputs use the createEmptyCatalog fallback which is a static
        // approximation. Exact statement equality with the two-database approach
        // requires string URL inputs (which use template1 on the same server).
        const singleDbResult = await createPlan(null, db.branch);
        const twoDbResult = await createPlan(db.main, db.branch);

        expect(singleDbResult).not.toBeNull();
        expect(twoDbResult).not.toBeNull();
        if (singleDbResult === null || twoDbResult === null)
          throw new Error("unreachable");

        // Target fingerprint must match (same target catalog)
        expect(singleDbResult.plan.target.fingerprint).toBe(
          twoDbResult.plan.target.fingerprint,
        );
        expect(twoDbResult.plan.statements).toEqual(
          singleDbResult.plan.statements,
        );
      }),
    );
  });
}
