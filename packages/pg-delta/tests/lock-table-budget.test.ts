/**
 * Split-then-apply against a container whose lock table is sized like a
 * small compute (`max_locks_per_transaction=64`, `max_connections=20`
 * ≈ 1.3k slots). 250 identity+PK tables do not fit in one segment.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apply, estimateLockTableBudget } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { splitPlan } from "../src/plan/baseline-commit.ts";
import { plan } from "../src/plan/plan.ts";
import {
  startLockBudgetCluster,
  type Cluster,
  type TestDb,
} from "./containers.ts";

const TABLE_COUNT = 250;

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
  test("splitPlan then apply succeeds with zero residual deltas", async () => {
    const target = await cluster.createDb("lock_split");
    try {
      const [targetState, sourceState] = [
        await extract(target.pool),
        await extract(source.pool),
      ];
      const thePlan = plan(targetState.factBase, sourceState.factBase);
      expect(thePlan.actions.length).toBeGreaterThan(TABLE_COUNT);
      expect(thePlan.actions.some((a) => a.newSegmentBefore)).toBe(false);

      const budget = await estimateLockTableBudget(target.pool, 1);
      const executable = splitPlan(thePlan, { maxLocks: budget.available });
      expect(executable.actions.some((a) => a.newSegmentBefore)).toBe(true);

      const events: Array<{ kind: string }> = [];
      const report = await apply(executable, target.pool, {
        fingerprintGate: false,
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
