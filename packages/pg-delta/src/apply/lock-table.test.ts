/**
 * Lock-table budget: capacity, connection reserve, and the target probe.
 * Pure except `estimateLockTableBudget`, which is mocked.
 */
import { describe, expect, test } from "bun:test";
import {
  computeLockTableBudget,
  defaultLockTableReserveConnections,
  estimateLockTableBudget,
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

  test("rejects a non-finite reserve override so the probe cannot go silent", () => {
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

  test("reserveConnections overrides the default", () => {
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

describe("estimateLockTableBudget", () => {
  test("reads the probe row into computeLockTableBudget", async () => {
    const target = {
      query: async () => ({
        rows: [
          {
            max_locks_per_transaction: 64,
            max_connections: 20,
            max_prepared_transactions: 0,
            busy_others: 0,
            other_backends: 1,
            prepared_xacts: 0,
          },
        ],
      }),
    };
    const budget = await estimateLockTableBudget(target, 1);
    expect(budget.reserveNew).toBe(1);
    expect(budget.available).toBe(1280 - 64);
  });
});
