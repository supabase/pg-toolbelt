/**
 * Proof-harness safety checks (stage 3 / §3.7): the proof loop turns
 * declared safety metadata into verified claims. These tests inject a
 * mis-declaring action into a real plan and assert the proof catches it —
 * the safety net that protects every rule.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

describe("proof: rewrite observation", () => {
  test("an undeclared in-place rewrite (relfilenode change) fails the proof", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_rw_src");
    const desired = await cluster.createDb("proof_rw_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, n text);
        INSERT INTO app.t SELECT i, i::text FROM generate_series(1, 5) i;
      `);
      // a column TYPE change rewrites the table; the rule correctly declares
      // rewriteRisk:true, so a correct plan PASSES
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint, n text);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const honest = plan(s.factBase, d.factBase);
      const typeAction = honest.actions.find((a) =>
        a.sql.includes("TYPE bigint"),
      );
      expect(typeAction?.rewriteRisk).toBe(true);

      // simulate a BUGGY rule: strip the rewriteRisk declaration. The proof
      // must now catch the relfilenode change that nobody warned about.
      const buggy = structuredClone(honest);
      for (const a of buggy.actions) a.rewriteRisk = false;
      const verdict = await provePlan(buggy, source.pool, d.factBase);
      expect(verdict.rewriteViolations.length).toBeGreaterThan(0);
      expect(verdict.rewriteViolations[0]?.table).toBe("app.t");
      expect(verdict.ok).toBe(false);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("a declared rewrite (rewriteRisk:true) is NOT a violation", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_rw_ok_src");
    const desired = await cluster.createDb("proof_rw_ok_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer);
        INSERT INTO app.t SELECT generate_series(1, 5);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const verdict = await provePlan(
        plan(s.factBase, d.factBase),
        source.pool,
        d.factBase,
      );
      // relfilenode changed, but the rule declared it — no violation, and
      // the rows survived the type cast
      expect(verdict.rewriteViolations).toHaveLength(0);
      expect(verdict.dataViolations).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("proof: auto-seed data preservation", () => {
  test("auto-seed makes an undeclared row loss on a kept table visible", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_seed_src");
    const desired = await cluster.createDb("proof_seed_dst");
    try {
      // identical schema both sides: a correct plan is empty. We inject a
      // TRUNCATE action with no `destroys` (so the table is "kept"), modeling
      // a rule that silently discards rows — auto-seed must surface it.
      const ddl = `CREATE SCHEMA app; CREATE TABLE app.t (id integer DEFAULT 1);`;
      await source.pool.query(ddl);
      await desired.pool.query(ddl);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      thePlan.actions.push({
        sql: `TRUNCATE app.t`,
        verb: "alter",
        produces: [],
        consumes: [{ kind: "table", schema: "app", name: "t" }],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "accessExclusive",
        newSegmentBefore: false,
        dataLoss: "none", // the lie the proof must catch
        rewriteRisk: false,
      });
      // without auto-seed the kept table is empty, so the loss is invisible
      const blind = await provePlan(
        structuredClone(thePlan),
        source.pool,
        d.factBase,
        {
          autoSeed: false,
        },
      );
      expect(blind.dataViolations).toHaveLength(0);
      // re-clone-equivalent: fresh dbs so the first run's TRUNCATE doesn't taint
      const source2 = await cluster.createDb("proof_seed_src2");
      try {
        await source2.pool.query(ddl);
        const s2 = await extract(source2.pool);
        const thePlan2 = plan(s2.factBase, d.factBase);
        thePlan2.actions.push({
          sql: `TRUNCATE app.t`,
          verb: "alter",
          produces: [],
          consumes: [{ kind: "table", schema: "app", name: "t" }],
          destroys: [],
          releases: [],
          transactionality: "transactional",
          lockClass: "accessExclusive",
          newSegmentBefore: false,
          dataLoss: "none",
          rewriteRisk: false,
        });
        const seeded = await provePlan(thePlan2, source2.pool, d.factBase, {
          autoSeed: true,
        });
        expect(seeded.dataViolations.length).toBeGreaterThan(0);
        expect(seeded.dataViolations[0]?.table).toBe("app.t");
      } finally {
        await source2.drop();
      }
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});
