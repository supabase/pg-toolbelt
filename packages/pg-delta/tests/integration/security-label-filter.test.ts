import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { shouldSkipDummySeclabelBuild } from "../postgres-alpine.ts";
import { withDb } from "../utils.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";

const DUMMY_PROVIDER_SETUP = `CREATE EXTENSION IF NOT EXISTS dummy_seclabel;`;

const SKIP_SECLABEL_TESTS = shouldSkipDummySeclabelBuild();

for (const pgVersion of POSTGRES_VERSIONS) {
  describe.skipIf(SKIP_SECLABEL_TESTS)(
    `security label filter DSL (pg${pgVersion})`,
    () => {
      test(
        "excludes all security_label changes when scope is negated",
        withDb(pgVersion, async (db) => {
          await Promise.all([
            db.main.query(DUMMY_PROVIDER_SETUP),
            db.branch.query(DUMMY_PROVIDER_SETUP),
          ]);
          await Promise.all([
            db.main.query(`CREATE SCHEMA labeled;`),
            db.branch.query(`
            CREATE SCHEMA labeled;
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS 'classified';
          `),
          ]);

          const result = await createPlan(db.main, db.branch, {
            filter: { not: { scope: "security_label" } },
          });

          const sql = flattenPlanStatements(result!.plan).join(";\n");
          expect(sql).not.toContain("SECURITY LABEL");
        }),
      );

      test(
        "provider filter excludes only matching provider",
        withDb(pgVersion, async (db) => {
          await Promise.all([
            db.main.query(DUMMY_PROVIDER_SETUP),
            db.branch.query(DUMMY_PROVIDER_SETUP),
          ]);
          await Promise.all([
            db.main.query(`CREATE SCHEMA labeled_provider_filter;`),
            db.branch.query(`
            CREATE SCHEMA labeled_provider_filter;
            SECURITY LABEL FOR dummy ON SCHEMA labeled_provider_filter IS 'classified';
          `),
          ]);

          const result = await createPlan(db.main, db.branch, {
            filter: { not: { scope: "security_label", provider: "dummy" } },
          });

          const sql = flattenPlanStatements(result!.plan).join(";\n");
          expect(sql).not.toContain("SECURITY LABEL FOR dummy");
        }),
      );
    },
  );
}
