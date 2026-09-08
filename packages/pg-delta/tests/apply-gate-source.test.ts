/**
 * apply() fingerprint gate can consume a caller-held source fact base
 * instead of re-extracting. Callers that already extracted the target they
 * planned from — and still hold exclusive write access — skip the gate
 * extract. A mismatched base still fails the gate.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { buildFactBase, type FactBase } from "../src/core/fact.ts";
import { extract } from "../src/extract/extract.ts";
import { plan, type Plan } from "../src/plan/plan.ts";
import {
  createTestDb,
  withServerVersionProbeCount,
  type TestDb,
} from "./containers.ts";

let db: TestDb;
let sourceFactBase: FactBase;
let thePlan: Plan;

beforeAll(async () => {
  db = await createTestDb("apply_gate_source");
  await db.pool.query(`CREATE SCHEMA app;`);
  const state = await extract(db.pool);
  sourceFactBase = state.factBase;
  thePlan = plan(state.factBase, state.factBase);
  expect(thePlan.actions).toHaveLength(0);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("apply() sourceFactBase fingerprint gate", () => {
  test("skips re-extraction when sourceFactBase matches the plan", async () => {
    let reextractCalls = 0;
    const { count, result } = await withServerVersionProbeCount(db.pool, () =>
      apply(thePlan, db.pool, {
        sourceFactBase,
        reextract: async () => {
          reextractCalls++;
          throw new Error("reextract must not run when sourceFactBase is set");
        },
      }),
    );

    expect(result.status).toBe("applied");
    expect(count).toBe(0);
    expect(reextractCalls).toBe(0);
  }, 60_000);

  test("rejects a sourceFactBase that does not match the plan fingerprint", async () => {
    // No `await`: bun's typings declare `.rejects.toThrow()` as void.
    expect(
      apply(thePlan, db.pool, { sourceFactBase: buildFactBase([], []) }),
    ).rejects.toThrow(/fingerprint gate failed/);
  }, 60_000);

  test("re-extracts when sourceFactBase is omitted", async () => {
    const { count, result } = await withServerVersionProbeCount(db.pool, () =>
      apply(thePlan, db.pool),
    );

    expect(result.status).toBe("applied");
    expect(count).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
