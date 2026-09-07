/**
 * Lock-table budget: capacity, connection reserve, per-action estimate,
 * and opt-in commit-boundary placement. Pure — no database.
 */
import { describe, expect, test } from "bun:test";
import { LOCK_TABLE_BUDGET_EXCEEDED } from "../core/diagnostic.ts";
import { segmentActions } from "./apply.ts";
import {
  LockTableBudgetExceededError,
  assertSegmentsFitLockTable,
  computeLockTableBudget,
  defaultLockTableReserveConnections,
  estimateActionLocks,
  estimateSegmentLocks,
  markBaselineCommitBoundaries,
} from "./lock-table.ts";

describe("defaultLockTableReserveConnections", () => {
  test("floors at 3 and otherwise takes 10% of max_connections", () => {
    expect(defaultLockTableReserveConnections(10)).toBe(3);
    expect(defaultLockTableReserveConnections(20)).toBe(3);
    expect(defaultLockTableReserveConnections(60)).toBe(6);
    expect(defaultLockTableReserveConnections(300)).toBe(30);
  });
});

describe("computeLockTableBudget", () => {
  test("reserves busy others plus new-connection margin against documented capacity", () => {
    const budget = computeLockTableBudget({
      maxLocksPerTransaction: 64,
      maxConnections: 60,
      maxPreparedTransactions: 0,
      busyOthers: 4,
      otherBackends: 4,
      preparedXacts: 0,
    });
    expect(budget.capacity).toBe(64 * 60);
    expect(budget.reserveNew).toBe(6);
    expect(budget.busyOthers).toBe(4);
    expect(budget.available).toBe(3840 - 64 * (4 + 6));
  });

  test("clamps reserveNew so we do not reserve more backends than can still connect", () => {
    const budget = computeLockTableBudget({
      maxLocksPerTransaction: 10,
      maxConnections: 10,
      maxPreparedTransactions: 0,
      busyOthers: 0,
      otherBackends: 8,
      preparedXacts: 0,
    });
    // default reserve is 3, but only 10 - 8 - 1 = 1 backend slot remains
    expect(budget.reserveNew).toBe(1);
    expect(budget.available).toBe(100 - 10 * (0 + 1));
  });

  test("subtracts in-flight prepared transactions from available", () => {
    const budget = computeLockTableBudget(
      {
        maxLocksPerTransaction: 64,
        maxConnections: 20,
        maxPreparedTransactions: 5,
        busyOthers: 0,
        otherBackends: 1,
        preparedXacts: 2,
      },
      1,
    );
    expect(budget.capacity).toBe(64 * 25);
    expect(budget.available).toBe(64 * 25 - 64 * (0 + 1 + 2));
  });

  test("rejects a non-finite reserve override so preflight cannot go silent", () => {
    expect(() =>
      computeLockTableBudget(
        {
          maxLocksPerTransaction: 64,
          maxConnections: 20,
          maxPreparedTransactions: 0,
          busyOthers: 0,
          otherBackends: 1,
          preparedXacts: 0,
        },
        Number.NaN,
      ),
    ).toThrow(/lockTableReserveConnections/);
  });

  test("ApplyOptions.lockTableReserveConnections overrides the default", () => {
    const budget = computeLockTableBudget(
      {
        maxLocksPerTransaction: 64,
        maxConnections: 20,
        maxPreparedTransactions: 0,
        busyOthers: 0,
        otherBackends: 1,
        preparedXacts: 0,
      },
      1,
    );
    expect(budget.reserveNew).toBe(1);
    expect(budget.available).toBe(1280 - 64);
  });
});

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

describe("markBaselineCommitBoundaries", () => {
  test("rejects a non-positive interval", () => {
    expect(() => markBaselineCommitBoundaries([], 0)).toThrow(
      /baselineCommitEvery/,
    );
    expect(() => markBaselineCommitBoundaries([], 1.5)).toThrow(
      /baselineCommitEvery/,
    );
  });

  test("marks the action after every N lock-holding creates", () => {
    const actions = Array.from({ length: 12 }, (_, i) => ({
      produces: [table(`t${String(i)}`)],
      newSegmentBefore: false,
      transactionality: "transactional" as const,
    }));
    const marked = markBaselineCommitBoundaries(actions, 5);
    expect(marked.map((a) => a.newSegmentBefore)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(segmentActions(marked)).toEqual([
      { start: 0, end: 5, transactional: true },
      { start: 5, end: 10, transactional: true },
      { start: 10, end: 12, transactional: true },
    ]);
  });

  test("does not mutate the input list", () => {
    const actions = [
      { produces: [table("a")], newSegmentBefore: false },
      { produces: [table("b")], newSegmentBefore: false },
    ];
    markBaselineCommitBoundaries(actions, 1);
    expect(actions[1]?.newSegmentBefore).toBe(false);
  });

  test("a folded create that produces table+index+sequence counts as 3 toward N", () => {
    const actions = [
      {
        produces: [table("t0"), index("t0_pkey"), sequence("t0_id_seq")],
        newSegmentBefore: false,
      },
      {
        produces: [table("t1")],
        newSegmentBefore: false,
      },
    ];
    const marked = markBaselineCommitBoundaries(actions, 3);
    expect(marked.map((a) => a.newSegmentBefore)).toEqual([false, true]);
  });

  test("does not mark when the flag would be unused (creates stay under N)", () => {
    const actions = [
      { produces: [table("a")], newSegmentBefore: false },
      { produces: [table("b")], newSegmentBefore: false },
    ];
    expect(
      markBaselineCommitBoundaries(actions, 10).every(
        (a) => a.newSegmentBefore === false,
      ),
    ).toBe(true);
  });
});

describe("assertSegmentsFitLockTable", () => {
  test("throws lock-table-budget-exceeded naming estimate, available, and the fix", () => {
    const actions = Array.from({ length: 30 }, (_, i) => ({
      verb: "create" as const,
      produces: [table(`t${String(i)}`)],
      destroys: [],
    }));
    const segments = [{ start: 0, end: 30, transactional: true }];
    const budget = computeLockTableBudget(
      {
        maxLocksPerTransaction: 10,
        maxConnections: 10,
        maxPreparedTransactions: 0,
        busyOthers: 0,
        otherBackends: 1,
        preparedXacts: 0,
      },
      1,
    );
    const estimate = estimateSegmentLocks(actions);
    expect(estimate).toBeGreaterThan(budget.available);

    let error: unknown;
    try {
      assertSegmentsFitLockTable(segments, actions, budget);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LockTableBudgetExceededError);
    const exceeded = error as LockTableBudgetExceededError;
    expect(exceeded.code).toBe(LOCK_TABLE_BUDGET_EXCEEDED);
    expect(exceeded.estimate).toBe(estimate);
    expect(exceeded.budget.available).toBe(budget.available);
    expect(exceeded.segmentIndex).toBe(0);
    expect(exceeded.message).toMatch(/lock-table-budget-exceeded/);
    expect(exceeded.message).toMatch(/baselineCommitEvery/);
    expect(exceeded.message).toMatch(/max_locks_per_transaction/);
    expect(exceeded.message).toContain(String(estimate));
    expect(exceeded.message).toContain(String(budget.available));
  });

  test("accepts a segment that fits after commit boundaries", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({
      verb: "create" as const,
      produces: [table(`t${String(i)}`)],
      destroys: [],
      newSegmentBefore: false,
      transactionality: "transactional" as const,
    }));
    const marked = markBaselineCommitBoundaries(raw, 5);
    const budget = computeLockTableBudget(
      {
        maxLocksPerTransaction: 64,
        maxConnections: 20,
        maxPreparedTransactions: 0,
        busyOthers: 0,
        otherBackends: 1,
        preparedXacts: 0,
      },
      1,
    );
    expect(() =>
      assertSegmentsFitLockTable(segmentActions(marked), marked, budget),
    ).not.toThrow();
  });
});
