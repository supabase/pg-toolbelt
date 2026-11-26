/**
 * ADD COLUMN of a domain with a CHECK / NOT NULL constraint rewrites the table
 * (PostgreSQL checks the constraints against the new column), so the action
 * must carry rewriteRisk. The rule does not mark it yet.
 *
 * Tracked by https://github.com/supabase/pg-toolbelt/issues/621; the assertion
 * below pins the bug and flips to `toBe(true)` when the rule decides it from
 * the domain's constraint facts.
 *
 * Stock alpine image; Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

describe("rewriteRisk: ADD COLUMN of a constrained domain", () => {
  test("is declared on the ADD COLUMN action", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("domain_rw_src");
    const desired = await cluster.createDb("domain_rw_dst");
    try {
      await source.pool.query(`CREATE TABLE t (a smallint);`);
      await desired.pool.query(`
        CREATE DOMAIN positive AS integer CHECK (VALUE > 0);
        CREATE TABLE t (a smallint, b positive);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      const addColumn = thePlan.actions.find((a) =>
        a.sql.includes("ADD COLUMN"),
      );
      expect(addColumn).toBeDefined();
      // Pins https://github.com/supabase/pg-toolbelt/issues/621: must become toBe(true) with the fix.
      expect(addColumn?.rewriteRisk).toBeFalsy();
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});
