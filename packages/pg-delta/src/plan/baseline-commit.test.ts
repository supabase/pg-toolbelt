import { describe, expect, test } from "bun:test";
import { assertPlanId, stampPlanId } from "./artifact.ts";
import { ENGINE_VERSION, type Action, type Plan } from "./plan.ts";
import { segmentActions } from "../apply/apply.ts";
import {
  estimateActionLocks,
  splitActions,
  splitPlan,
} from "./baseline-commit.ts";

const table = (name: string) => ({
  kind: "table" as const,
  schema: "app",
  name,
});
const index = (name: string) => ({
  kind: "index" as const,
  schema: "app",
  name,
});
const sequence = (name: string) => ({
  kind: "sequence" as const,
  schema: "app",
  name,
});

function createAction(
  produces: ReadonlyArray<{ kind: string }>,
  newSegmentBefore = false,
): LockPackAction {
  return {
    verb: "create",
    produces,
    destroys: [],
    newSegmentBefore,
    transactionality: "transactional",
  };
}

type LockPackAction = {
  verb: "create";
  produces: ReadonlyArray<{ kind: string }>;
  destroys: [];
  newSegmentBefore: boolean;
  transactionality: "transactional";
};

describe("estimateActionLocks", () => {
  test("counts a created table plus toast pair plus one catalog slot", () => {
    expect(
      estimateActionLocks({
        verb: "create",
        produces: [table("t")],
        destroys: [],
      }),
    ).toBe(4);
  });

  test("counts a PK constraint as a lock-holding create (backing index)", () => {
    expect(
      estimateActionLocks({
        verb: "create",
        produces: [{ kind: "constraint" }],
        destroys: [],
      }),
    ).toBe(2);
  });

  test("adds one slot per created index and sequence on the same action", () => {
    expect(
      estimateActionLocks({
        verb: "create",
        produces: [table("t"), index("t_pkey"), sequence("t_id_seq")],
        destroys: [],
      }),
    ).toBe(6);
  });

  test("counts a dropped table the same way (toast held until COMMIT)", () => {
    expect(
      estimateActionLocks({
        verb: "drop",
        produces: [],
        destroys: [table("t")],
      }),
    ).toBe(4);
  });

  test("an ALTER of an existing relation costs one lock plus catalog", () => {
    expect(
      estimateActionLocks({
        verb: "alter",
        produces: [],
        destroys: [],
        consumes: [table("t")],
      }),
    ).toBe(2);
  });

  test("ADD COLUMN still counts the consumed table, not just the column", () => {
    expect(
      estimateActionLocks({
        verb: "alter",
        produces: [{ kind: "column" }],
        destroys: [],
        consumes: [table("t")],
      }),
    ).toBe(2);
  });
});

describe("splitActions", () => {
  test("rejects a non-integer maxLocks", () => {
    expect(() => splitActions([], 1.5)).toThrow(/maxLocks/);
    expect(() => splitActions([], Number.NaN)).toThrow(/maxLocks/);
  });

  test("clamps a non-positive maxLocks so a zero budget still isolates actions", () => {
    const actions = [createAction([table("a")]), createAction([table("b")])];
    const packed = splitActions(actions, 0);
    expect(packed.map((a) => a.newSegmentBefore)).toEqual([false, true]);
  });

  test("packs table creates to maxLocks without splitting one action", () => {
    // Each CREATE TABLE estimates 4 slots; maxLocks 8 → two per segment.
    const actions = Array.from({ length: 5 }, (_, i) =>
      createAction([table(`t${String(i)}`)]),
    );
    const packed = splitActions(actions, 8);
    expect(packed.map((a) => a.newSegmentBefore)).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(segmentActions(packed)).toEqual([
      { start: 0, end: 2, transactional: true },
      { start: 2, end: 4, transactional: true },
      { start: 4, end: 5, transactional: true },
    ]);
  });

  test("does not split inside one action", () => {
    const actions = [
      createAction([table("t0"), index("t0_pkey"), sequence("t0_id_seq")]),
      createAction([table("t1")]),
    ];
    const packed = splitActions(actions, 4);
    expect(packed.map((a) => a.newSegmentBefore)).toEqual([false, true]);
  });

  test("leaves an oversized first action as its own segment", () => {
    const actions = [
      createAction([table("t0"), index("t0_pkey"), sequence("t0_id_seq")]),
      createAction([table("t1")]),
      createAction([table("t2")]),
    ];
    const packed = splitActions(actions, 4);
    expect(segmentActions(packed)).toEqual([
      { start: 0, end: 1, transactional: true },
      { start: 1, end: 2, transactional: true },
      { start: 2, end: 3, transactional: true },
    ]);
  });

  test("does not mutate the input list", () => {
    const actions = [createAction([table("a")]), createAction([table("b")])];
    splitActions(actions, 4);
    expect(actions[1]?.newSegmentBefore).toBe(false);
  });

  test("treats an existing newSegmentBefore as a pack reset", () => {
    const actions = [
      createAction([table("a")]),
      createAction([table("b")], true),
      createAction([table("c")]),
    ];
    const packed = splitActions(actions, 8);
    expect(packed.map((a) => a.newSegmentBefore)).toEqual([false, true, false]);
  });

  test("does not mark when the whole list fits", () => {
    const actions = [createAction([table("a")]), createAction([table("b")])];
    expect(
      splitActions(actions, 10).every((a) => a.newSegmentBefore === false),
    ).toBe(true);
  });
});

function stubPlan(actions: Action[]): Plan {
  return stampPlanId({
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: "a".repeat(64) },
    target: { fingerprint: "b".repeat(64) },
    preamble: [],
    deltas: [],
    filteredDeltas: [],
    renameCandidates: [],
    actions,
    safetyReport: {
      destructiveActions: 0,
      rewriteRiskActions: 0,
      nonTransactionalActions: 0,
      lockClasses: {},
    },
  });
}

function stubAction(name: string): Action {
  return {
    sql: `CREATE TABLE app.${name} (id int)`,
    verb: "create",
    produces: [table(name)],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "accessExclusive",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
  };
}

describe("splitPlan", () => {
  test("does not change planId when no new marks are needed", () => {
    const thePlan = stubPlan([stubAction("a"), stubAction("b")]);
    const packed = splitPlan(thePlan, { maxLocks: 64 });
    expect(packed.planId).toBe(thePlan.planId);
    assertPlanId(packed, "splitPlan");
  });

  test("restamps planId after packing so apply accepts the marks", () => {
    const thePlan = stubPlan([
      stubAction("a"),
      stubAction("b"),
      stubAction("c"),
    ]);
    const packed = splitPlan(thePlan, { maxLocks: 8 });
    expect(packed.actions.some((a) => a.newSegmentBefore)).toBe(true);
    expect(packed.planId).not.toBe(thePlan.planId);
    assertPlanId(packed, "splitPlan");
  });

  test("does not mutate the input plan", () => {
    const thePlan = stubPlan([
      stubAction("a"),
      stubAction("b"),
      stubAction("c"),
    ]);
    const before = thePlan.actions.map((a) => a.newSegmentBefore);
    splitPlan(thePlan, { maxLocks: 8 });
    expect(thePlan.actions.map((a) => a.newSegmentBefore)).toEqual(before);
  });
});
