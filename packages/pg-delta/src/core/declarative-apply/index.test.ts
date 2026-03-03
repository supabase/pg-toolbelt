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

// Track the pool created internally via createPool so we can verify cleanup.
let lastCreatedPool: Pool & { endCalled: boolean };

mock.module("../postgres-config.ts", () => ({
  createPool: () => {
    lastCreatedPool = createMockPool();
    return lastCreatedPool;
  },
}));

// SSL config returns a pass-through to avoid file reads
mock.module("../plan/ssl-config.ts", () => ({
  parseSslConfig: async (url: string) => ({
    cleanedUrl: url,
    ssl: false,
  }),
}));

function createMockPool(): Pool & { endCalled: boolean } {
  const pool = {
    endCalled: false,
    connect: async () => {
      throw new Error("should not connect");
    },
    end: async () => {
      pool.endCalled = true;
    },
    query: async () => {
      throw new Error("should not query");
    },
  } as unknown as Pool & { endCalled: boolean };
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

    expect(pool.endCalled).toBe(false);
  });

  test("internally-created pool IS closed on early failure", async () => {
    await expect(
      applyDeclarativeSchema({
        content: [{ filePath: "test.sql", sql: "CREATE TABLE t(id int);" }],
        targetUrl: "postgresql://localhost/test",
      }),
    ).rejects.toThrow("simulated catalog extraction failure");

    expect(lastCreatedPool).toBeDefined();
    expect(lastCreatedPool.endCalled).toBe(true);
  });
});
