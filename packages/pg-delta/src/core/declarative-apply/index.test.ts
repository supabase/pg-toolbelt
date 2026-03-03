import { describe, expect, mock, test } from "bun:test";
import type { Pool } from "pg";
import { applyDeclarativeSchema } from "./index.ts";

// Mock extractCatalogProviders to throw, simulating an early failure
// before roundApply is ever reached.
mock.module("./extract-catalog-providers.ts", () => ({
  extractCatalogProviders: async () => {
    throw new Error("simulated catalog extraction failure");
  },
}));

// Track the pool created internally via createManagedPool so we can verify cleanup.
let lastCreatedPool: Pool & { closeCalled: boolean };

mock.module("../postgres-config.ts", () => ({
  createManagedPool: async () => {
    lastCreatedPool = createMockPool();
    return {
      pool: lastCreatedPool,
      close: async () => {
        lastCreatedPool.closeCalled = true;
      },
    };
  },
}));

function createMockPool(): Pool & { closeCalled: boolean } {
  const pool = {
    closeCalled: false,
    connect: async () => {
      throw new Error("should not connect");
    },
    end: async () => {},
    query: async () => {
      throw new Error("should not query");
    },
  } as unknown as Pool & { closeCalled: boolean };
  return pool;
}

describe("applyDeclarativeSchema", () => {
  test("caller-owned pool is NOT closed on early failure", async () => {
    const pool = createMockPool();

    await expect(
      applyDeclarativeSchema({
        content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
        pool,
      }),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(pool.closeCalled).toBe(false);
  });

  test("internally-created pool IS closed on early failure", async () => {
    await expect(
      applyDeclarativeSchema({
        content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
        targetUrl: "postgresql://localhost/test",
      }),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(lastCreatedPool).toBeDefined();
    expect(lastCreatedPool.closeCalled).toBe(true);
  });
});
