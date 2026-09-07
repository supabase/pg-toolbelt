/**
 * Lock-table preflight + opt-in baseline commit boundaries against a
 * container whose lock table is sized like a small compute
 * (`max_locks_per_transaction=64`, `max_connections=20` ≈ 1.3k slots).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apply, LockTableBudgetExceededError } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import {
  startLockBudgetCluster,
  type Cluster,
  type TestDb,
} from "./containers.ts";

const TABLE_COUNT = 250;
const COMMIT_EVERY = 40;

function identityPkTablesSql(n: number): string {
  return `
    CREATE SCHEMA bench;
    DO $body$
    DECLARE i int;
    BEGIN
      FOR i IN 1..${String(n)} LOOP
        EXECUTE format(
          'CREATE TABLE bench.t%s (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY)',
          i
        );
      END LOOP;
    END
    $body$;
  `;
}

let cluster: Cluster;
let source: TestDb;

beforeAll(async () => {
  cluster = await startLockBudgetCluster();
  source = await cluster.createDb("lock_src");
  await source.pool.query(identityPkTablesSql(TABLE_COUNT));
}, 180_000);

afterAll(async () => {
  await source?.drop().catch(() => {});
  await cluster?.stop();
}, 60_000);

describe("lock-table budget", () => {
  test("preflight rejects a lock-table-busting baseline before the first DDL", async () => {
    const target = await cluster.createDb("lock_preflight");
    try {
      const [targetState, sourceState] = [
        await extract(target.pool),
        await extract(source.pool),
      ];
      const thePlan = plan(targetState.factBase, sourceState.factBase);
      expect(thePlan.actions.length).toBeGreaterThan(TABLE_COUNT);
      expect(thePlan.actions.some((a) => a.newSegmentBefore)).toBe(false);

      let error: unknown;
      try {
        await apply(thePlan, target.pool, {
          fingerprintGate: false,
          lockTableReserveConnections: 1,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(LockTableBudgetExceededError);
      const exceeded = error as LockTableBudgetExceededError;
      expect(exceeded.estimate).toBeGreaterThan(exceeded.budget.available);
      expect(exceeded.message).toMatch(/baselineCommitEvery/);

      const rels = await target.pool.query(
        `SELECT count(*)::int AS n
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'bench' AND c.relkind = 'r'`,
      );
      expect((rels.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await target.drop();
    }
  }, 180_000);

  test("baselineCommitEvery applies in chunks with zero residual deltas", async () => {
    const target = await cluster.createDb("lock_chunk");
    try {
      const [targetState, sourceState] = [
        await extract(target.pool),
        await extract(source.pool),
      ];
      const thePlan = plan(targetState.factBase, sourceState.factBase, {
        baselineCommitEvery: COMMIT_EVERY,
      });
      expect(thePlan.actions.some((a) => a.newSegmentBefore)).toBe(true);

      const events: Array<{ kind: string }> = [];
      const report = await apply(thePlan, target.pool, {
        fingerprintGate: false,
        lockTableReserveConnections: 1,
        onEvent: (e) => events.push(e),
      });
      expect(report.status).toBe("applied");
      expect(
        events.filter((e) => e.kind === "segmentStart").length,
      ).toBeGreaterThan(1);

      const after = await extract(target.pool);
      const residual = plan(after.factBase, sourceState.factBase);
      expect(residual.actions).toHaveLength(0);
    } finally {
      await target.drop();
    }
  }, 180_000);
});
