/**
 * Apply must send each transactional segment as O(1) round trips (bounded
 * multi-statement batches + a separate COMMIT), not one query per action.
 * Lock-table packing (`splitPlan`) happens before apply, not on this wire.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { createTestDb, type TestDb } from "./containers.ts";
import {
  planFromActions,
  txnAction,
  withApplyQueries,
} from "./apply-test-helpers.ts";

const ACTION_COUNT = 200;
/** one transactional batch + COMMIT (sub-batches stay well under 500). */
const MAX_ROUND_TRIPS = 3;

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("apply() transactional round trips", () => {
  test("a single-segment plan is O(segments), not O(actions)", async () => {
    const db = await createTestDb("apply_roundtrips");
    dbs.push(db);

    const thePlan = planFromActions(
      Array.from({ length: ACTION_COUNT }, (_, i) =>
        txnAction(`SELECT ${String(i)}`),
      ),
    );

    const { result, queries } = await withApplyQueries(db.pool, () =>
      apply(thePlan, db.pool, {
        fingerprintGate: false,
        lockTimeoutMs: 5000,
        batchTransactional: true,
      }),
    );

    expect(result.status).toBe("applied");
    expect(result.appliedActions).toBe(ACTION_COUNT);
    expect(queries.length).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
    expect(queries.length).toBeLessThan(ACTION_COUNT);
    expect(
      queries.some((sql) => sql.includes("BEGIN") && sql.includes("SELECT 0")),
    ).toBe(true);
    expect(queries.some((sql) => sql.trim() === "COMMIT")).toBe(true);
  }, 120_000);

  test("the default path still pays one query per action", async () => {
    const db = await createTestDb("apply_roundtrips_default");
    dbs.push(db);

    const count = 20;
    const thePlan = planFromActions(
      Array.from({ length: count }, (_, i) => txnAction(`SELECT ${String(i)}`)),
    );

    const { result, queries } = await withApplyQueries(db.pool, () =>
      apply(thePlan, db.pool, {
        fingerprintGate: false,
        lockTimeoutMs: 5000,
      }),
    );

    expect(result.status).toBe("applied");
    expect(queries.length).toBeGreaterThan(count);
    expect(
      queries.filter((sql) => /^SELECT \d+$/.test(sql.trim())).length,
    ).toBe(count);
  }, 120_000);
});
