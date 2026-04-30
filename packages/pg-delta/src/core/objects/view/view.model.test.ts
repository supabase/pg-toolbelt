import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { extractViews, View } from "./view.model.ts";

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

describe("extractViews", () => {
  test("skips rows where pg_get_viewdef returned NULL after exhausting retries", async () => {
    const views = await extractViews(
      mockPool([
        {
          ...baseRow,
          name: '"good_view"',
          definition: "SELECT 1",
        },
        { ...baseRow, name: '"orphan_view"', definition: null },
      ]),
      NO_BACKOFF,
    );

    expect(views).toHaveLength(1);
    expect(views[0]).toBeInstanceOf(View);
    expect(views[0]?.name).toBe('"good_view"');
    expect(views[0]?.definition).toBe("SELECT 1");
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractViews(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
        NO_BACKOFF,
      ),
    ).resolves.toEqual([]);
  });

  test("returns all views when every row has a valid definition", async () => {
    const views = await extractViews(
      mockPool([
        { ...baseRow, name: '"a"', definition: "SELECT 1" },
        { ...baseRow, name: '"b"', definition: "SELECT 2" },
      ]),
      NO_BACKOFF,
    );
    expect(views.map((v) => v.name)).toEqual(['"a"', '"b"']);
  });

  test("recovers when pg_get_viewdef is NULL on first attempt but resolved on retry", async () => {
    const views = await extractViews(
      mockPoolSequence(
        [{ ...baseRow, name: '"racy_view"', definition: null }],
        [{ ...baseRow, name: '"racy_view"', definition: "SELECT 42" }],
      ),
      { retries: 2, backoffMs: 0 },
    );
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe('"racy_view"');
    expect(views[0]?.definition).toBe("SELECT 42");
  });
});
