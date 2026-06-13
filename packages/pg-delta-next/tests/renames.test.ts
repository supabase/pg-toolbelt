/**
 * Rename corpus (stage 9 gate): leaf rename, container rename, ambiguous
 * pair, near-miss degradation, swap case, and column-VALUE survival on
 * every auto rename (row counts can't see a column drop+create — values
 * can; this is the data-preservation point of the whole feature).
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

async function pair(
  prefix: string,
  fromSql: string,
  toSql: string,
): Promise<{ source: TestDb; desired: TestDb; drop: () => Promise<void> }> {
  const cluster = await sharedCluster();
  const source = await cluster.createDb(`${prefix}_src`);
  const desired = await cluster.createDb(`${prefix}_dst`);
  await source.pool.query(fromSql);
  await desired.pool.query(toSql);
  return {
    source,
    desired,
    drop: async () => {
      await Promise.all([source.drop(), desired.drop()]);
    },
  };
}

describe("stage 9: renames", () => {
  test("column leaf rename: emitted as RENAME COLUMN, values survive", async () => {
    const dbs = await pair(
      "ren_col",
      `CREATE SCHEMA app;
       CREATE TABLE app.users (id integer PRIMARY KEY, full_name text);
       INSERT INTO app.users VALUES (1, 'ada'), (2, 'grace');`,
      `CREATE SCHEMA app;
       CREATE TABLE app.users (id integer PRIMARY KEY, display_name text);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const renameActions = thePlan.actions.filter((a) =>
        a.sql.includes("RENAME COLUMN"),
      );
      expect(renameActions).toHaveLength(1);
      // no drop+create of the column
      expect(
        thePlan.actions.filter(
          (a) => a.verb === "drop" && a.destroys[0]?.kind === "column",
        ),
      ).toHaveLength(0);
      const report = await apply(thePlan, dbs.source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      const rows = await dbs.source.pool.query(
        `SELECT display_name FROM app.users ORDER BY id`,
      );
      // the VALUES survived — a drop+create would have nulled them
      expect(
        rows.rows.map((r) => (r as { display_name: string }).display_name),
      ).toEqual(["ada", "grace"]);
      const proven = await extract(dbs.source.pool);
      expect(proven.factBase.rootHash).toBe(d.factBase.rootHash);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("container rename: one ALTER TABLE RENAME, subtree emits nothing, rows survive", async () => {
    const dbs = await pair(
      "ren_tab",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_name (id integer NOT NULL, note text DEFAULT 'x');
       INSERT INTO app.old_name VALUES (1, 'keep');`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_name (id integer NOT NULL, note text DEFAULT 'x');`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      // exactly one action: the rename (no column adds, no drops)
      expect(thePlan.actions).toHaveLength(1);
      expect(thePlan.actions[0]?.verb).toBe("alter");
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
      const rows = await dbs.source.pool.query(`SELECT note FROM app.new_name`);
      expect((rows.rows[0] as { note: string }).note).toBe("keep");
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("renames: 'off' (the default) preserves drop+create", async () => {
    const dbs = await pair(
      "ren_off",
      `CREATE SCHEMA app; CREATE TABLE app.old_name (id integer);`,
      `CREATE SCHEMA app; CREATE TABLE app.new_name (id integer);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase);
      expect(thePlan.renameCandidates).toHaveLength(0);
      expect(thePlan.actions.some((a) => a.sql.includes("RENAME"))).toBe(false);
      expect(thePlan.actions.some((a) => a.verb === "drop")).toBe(true);
      expect(thePlan.safetyReport.destructiveActions).toBeGreaterThan(0);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("'prompt' reports the candidate but applies only when accepted", async () => {
    const dbs = await pair(
      "ren_prompt",
      `CREATE SCHEMA app; CREATE TABLE app.old_name (id integer);`,
      `CREATE SCHEMA app; CREATE TABLE app.new_name (id integer);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const unconfirmed = plan(s.factBase, d.factBase, { renames: "prompt" });
      expect(unconfirmed.renameCandidates).toHaveLength(1);
      expect(unconfirmed.renameCandidates[0]?.status).toBe("unambiguous");
      // not accepted -> still drop+create
      expect(unconfirmed.actions.some((a) => a.verb === "drop")).toBe(true);

      const candidate = unconfirmed.renameCandidates[0]!;
      const confirmed = plan(s.factBase, d.factBase, {
        renames: "prompt",
        acceptRenames: [{ from: candidate.from, to: candidate.to }],
      });
      expect(confirmed.actions).toHaveLength(1);
      expect(confirmed.actions[0]?.sql).toContain("RENAME");
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("ambiguous pairs are reported, never guessed", async () => {
    const dbs = await pair(
      "ren_amb",
      `CREATE SCHEMA app;
       CREATE TABLE app.a1 (id integer);
       CREATE TABLE app.a2 (id integer);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.b1 (id integer);
       CREATE TABLE app.b2 (id integer);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const ambiguous = thePlan.renameCandidates.filter(
        (c) => c.status === "ambiguous",
      );
      expect(ambiguous.length).toBe(4); // 2 removed × 2 added
      // none applied: the plan still drops and creates
      expect(thePlan.actions.some((a) => a.sql.includes("RENAME"))).toBe(false);
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("a swap surfaces as set-deltas, never a guessed rename", async () => {
    const dbs = await pair(
      "ren_swap",
      `CREATE SCHEMA app;
       CREATE TABLE app.x (id integer);
       CREATE TABLE app.y (note text);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.y (id integer);
       CREATE TABLE app.x (note text);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      // both table ids exist on both sides — the swap is column-level
      // set/remove/add deltas, so NO table rename candidate can exist
      expect(
        thePlan.renameCandidates.filter((c) => c.kind === "table"),
      ).toHaveLength(0);
      expect(
        thePlan.actions.some(
          (a) => a.sql.includes("ALTER TABLE") && a.sql.includes("RENAME TO"),
        ),
      ).toBe(false);
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("near-miss (index def embeds the table name) degrades to drop+create with a reason", async () => {
    const dbs = await pair(
      "ren_near",
      `CREATE SCHEMA app;
       CREATE TABLE app.old_name (id integer);
       CREATE INDEX old_idx ON app.old_name (id);`,
      `CREATE SCHEMA app;
       CREATE TABLE app.new_name (id integer);
       CREATE INDEX old_idx ON app.new_name (id);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      const nearMisses = thePlan.renameCandidates.filter(
        (c) => c.status === "nearMiss",
      );
      expect(nearMisses.length).toBeGreaterThan(0);
      expect(nearMisses[0]?.reason).toMatch(/subtree differs/);
      // degraded, but still correct end-to-end
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
    } finally {
      await dbs.drop();
    }
  }, 60_000);

  test("schema container rename carries its whole subtree", async () => {
    const dbs = await pair(
      "ren_schema",
      `CREATE SCHEMA olds;
       CREATE TABLE olds.t (id integer DEFAULT 7);
       INSERT INTO olds.t VALUES (1);`,
      `CREATE SCHEMA news;
       CREATE TABLE news.t (id integer DEFAULT 7);`,
    );
    try {
      const [s, d] = [
        await extract(dbs.source.pool),
        await extract(dbs.desired.pool),
      ];
      const thePlan = plan(s.factBase, d.factBase, { renames: "auto" });
      expect(thePlan.actions).toHaveLength(1);
      expect(thePlan.actions[0]?.sql).toContain("ALTER SCHEMA");
      const verdict = await provePlan(thePlan, dbs.source.pool, d.factBase);
      expect(verdict.ok).toBe(true);
      const rows = await dbs.source.pool.query(`SELECT id FROM news.t`);
      expect((rows.rows[0] as { id: number }).id).toBe(1);
    } finally {
      await dbs.drop();
    }
  }, 60_000);
});
