import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
import { compileSerializeDSL } from "../../src/core/integrations/serialize/dsl.ts";
import { supabase as supabaseIntegration } from "../../src/core/integrations/supabase.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { withDbSupabaseIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

const pgVersion = 17;

const installPgNetSql = dedent`
  CREATE EXTENSION IF NOT EXISTS pg_net;
`;

const dropPgNetSql = "DROP EXTENSION pg_net;";

describe(`supabase integration e2e (pg${pgVersion})`, () => {
  test(
    "captures pg_net extension drops in createPlan",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.main.query(installPgNetSql);
      await db.branch.query(installPgNetSql);
      await db.branch.query(dropPgNetSql);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      expect(planResult).not.toBeNull();
      expect(planResult?.plan.statements).toMatchInlineSnapshot(`
        [
          "DROP EXTENSION pg_net",
        ]
      `);
    }),
    120_000,
  );

  test(
    "roundtrips pg_net extension drops through the supabase integration",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.main.query(installPgNetSql);
      await db.branch.query(installPgNetSql);
      await db.branch.query(dropPgNetSql);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
      });

      expect(planResult).not.toBeNull();

      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        integration: {
          filter: compileFilterDSL(supabaseIntegration.filter),
          serialize: compileSerializeDSL(supabaseIntegration.serialize),
        },
        assertSqlStatements: (sqlStatements) => {
          expect(sqlStatements).toMatchInlineSnapshot(`
            [
              "DROP EXTENSION pg_net",
            ]
          `);
        },
      });
    }),
    120_000,
  );
});
