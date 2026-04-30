import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import {
  extractMaterializedViews,
  MaterializedView,
} from "./materialized-view.model.ts";

const baseRow = {
  schema: "public",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d" as const,
  is_partition: false,
  options: null,
  partition_bound: null,
  owner: "postgres",
  comment: null,
  columns: [],
  privileges: [],
};

const mockPool = (rows: unknown[]): Pool =>
  ({ query: async () => ({ rows }) }) as unknown as Pool;

const mockPoolSequence = (...attempts: unknown[][]): Pool => {
  let i = 0;
  return {
    query: async () => ({
      rows: attempts[Math.min(i++, attempts.length - 1)],
    }),
  } as unknown as Pool;
};

const NO_BACKOFF = { backoffMs: 0 } as const;

describe("extractMaterializedViews", () => {
  test("skips rows where pg_get_viewdef returned NULL after exhausting retries", async () => {
    const mvs = await extractMaterializedViews(
      mockPool([
        {
          ...baseRow,
          name: '"good_mv"',
          definition: "SELECT 1",
        },
        { ...baseRow, name: '"orphan_mv"', definition: null },
      ]),
      NO_BACKOFF,
    );

    expect(mvs).toHaveLength(1);
    expect(mvs[0]).toBeInstanceOf(MaterializedView);
    expect(mvs[0]?.name).toBe('"good_mv"');
    expect(mvs[0]?.definition).toBe("SELECT 1");
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractMaterializedViews(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
        NO_BACKOFF,
      ),
    ).resolves.toEqual([]);
  });

  test("returns all materialized views when every row has a valid definition", async () => {
    const mvs = await extractMaterializedViews(
      mockPool([
        { ...baseRow, name: '"a"', definition: "SELECT 1" },
        { ...baseRow, name: '"b"', definition: "SELECT 2" },
      ]),
      NO_BACKOFF,
    );
    expect(mvs.map((m) => m.name)).toEqual(['"a"', '"b"']);
  });

  test("recovers when pg_get_viewdef is NULL on first attempt but resolved on retry", async () => {
    const mvs = await extractMaterializedViews(
      mockPoolSequence(
        [{ ...baseRow, name: '"racy_mv"', definition: null }],
        [{ ...baseRow, name: '"racy_mv"', definition: "SELECT 42" }],
      ),
      { retries: 2, backoffMs: 0 },
    );
    expect(mvs).toHaveLength(1);
    expect(mvs[0]?.name).toBe('"racy_mv"');
    expect(mvs[0]?.definition).toBe("SELECT 42");
  });
});
