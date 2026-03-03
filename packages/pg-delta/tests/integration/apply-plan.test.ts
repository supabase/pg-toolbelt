import { describe, expect, test } from "bun:test";
import { applyPlan } from "../../src/core/plan/apply.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`applyPlan (pg${pgVersion})`, () => {
    test(
      "returns invalid_plan when statements array is empty",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.test_table (id integer)");

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const plan = result.plan;

        plan.statements = [];

        const applied = await applyPlan(plan, db.main, db.branch);
        expect(applied.status).toBe("invalid_plan");
        expect(applied).toHaveProperty("message");
      }),
    );

    test(
      "returns already_applied when source fingerprint matches target",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.test_table (id integer)");

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const plan = result.plan;

        plan.target.fingerprint = plan.source.fingerprint;

        const applied = await applyPlan(plan, db.main, db.branch);
        expect(applied.status).toBe("already_applied");
      }),
    );

    test(
      "returns fingerprint_mismatch when source database changed",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.test_table (id integer)");

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const plan = result.plan;

        await db.main.query("CREATE TABLE public.extra_table (x integer)");

        const applied = await applyPlan(plan, db.main, db.branch);
        expect(applied.status).toBe("fingerprint_mismatch");
        expect(applied).toHaveProperty("current");
        expect(applied).toHaveProperty("expected");
      }),
    );

    test(
      "returns failed when SQL execution errors",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.test_table (id integer)");

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const plan = result.plan;

        plan.statements = ["INVALID SQL SYNTAX"];

        const applied = await applyPlan(plan, db.main, db.branch);
        expect(applied.status).toBe("failed");
        expect(applied).toHaveProperty("error");
        expect(applied).toHaveProperty("script");
      }),
    );
  });

  describe(`createPlan (pg${pgVersion})`, () => {
    test(
      "filter DSL restricts plan to matching schema",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE SCHEMA custom_schema");
        await db.branch.query("CREATE TABLE public.pub_table (id integer)");
        await db.branch.query(
          "CREATE TABLE custom_schema.priv_table (id integer)",
        );

        const result = await createPlan(db.main, db.branch, {
          filter: { schema: "public" },
        });

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const sql = result.plan.statements.join("\n");
        expect(sql).toContain("pub_table");
        expect(sql).not.toContain("priv_table");
        expect(sql).not.toContain("CREATE SCHEMA");
      }),
    );

    test(
      "source null produces plan from empty catalog baseline",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.from_scratch (id integer)");

        const result = await createPlan(null, db.branch);

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        expect(result.plan.statements.length).toBeGreaterThan(0);
        const sql = result.plan.statements.join("\n");
        expect(sql).toContain("from_scratch");
      }),
    );
  });
}
