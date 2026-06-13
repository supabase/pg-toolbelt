/**
 * Compaction (§3.6, stage 5 deliverable 4): cosmetic by contract.
 * The gate: proof results are IDENTICAL with compaction on and off, and
 * the compacted plan folds column clauses into CREATE TABLE (asserted as
 * action-shape budgets, never SQL bytes).
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

const RICH_SCHEMA = `
  CREATE SCHEMA app;
  CREATE SEQUENCE app.id_seq;
  CREATE TABLE app.users (
    id integer NOT NULL DEFAULT nextval('app.id_seq'),
    email text NOT NULL,
    score numeric(10,2) DEFAULT 0.0,
    PRIMARY KEY (id)
  );
  CREATE TABLE app.events (created_at timestamptz NOT NULL, payload text)
    PARTITION BY RANGE (created_at);
  CREATE TABLE app.events_2026 PARTITION OF app.events
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
  CREATE INDEX users_email_idx ON app.users (email);
  CREATE VIEW app.v AS SELECT id, email FROM app.users;
`;

describe("compaction", () => {
  test("proof results identical with compaction on and off; compacted plan is smaller", async () => {
    const cluster = await sharedCluster();
    const desired = await cluster.createDb("compact_dst");
    const cloneA = await cluster.createDb("compact_a");
    const cloneB = await cluster.createDb("compact_b");
    try {
      await desired.pool.query(RICH_SCHEMA);
      const desiredState = await extract(desired.pool);
      const emptyA = await extract(cloneA.pool);
      const emptyB = await extract(cloneB.pool);

      const compacted = plan(emptyA.factBase, desiredState.factBase);
      const decomposed = plan(emptyB.factBase, desiredState.factBase, {
        compact: false,
      });

      // shape budget: the compacted plan folded the users columns
      expect(compacted.actions.length).toBeLessThan(decomposed.actions.length);
      const addColumns = compacted.actions.filter(
        (a) => a.verb === "create" && a.produces[0]?.kind === "column",
      );
      // partitioned-parent columns were already inlined pre-compaction;
      // the plain table's columns must now be folded too
      expect(addColumns).toHaveLength(0);

      const [verdictA, verdictB] = [
        await provePlan(compacted, cloneA.pool, desiredState.factBase),
        await provePlan(decomposed, cloneB.pool, desiredState.factBase),
      ];
      expect(verdictA.ok).toBe(true);
      expect(verdictB.ok).toBe(true);
    } finally {
      await Promise.all([desired.drop(), cloneA.drop(), cloneB.drop()]);
    }
  }, 120_000);

  test("a column whose dependency lands between CREATE TABLE and the column stays unfolded", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("compact_nf_src");
    const desired = await cluster.createDb("compact_nf_dst");
    try {
      // the enum value-set migration alters the type AFTER the new table
      // would be created — a column of that type cannot fold across it
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a', 'b', 'c');
        CREATE TABLE app.existing (s app.status);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a', 'c');
        CREATE TABLE app.existing (s app.status);
        CREATE TABLE app.fresh (s app.status, note text);
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const verdict = await provePlan(
        thePlan,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});
