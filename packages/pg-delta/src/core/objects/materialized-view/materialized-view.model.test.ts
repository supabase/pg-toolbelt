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

describe("extractMaterializedViews", () => {
  test("skips rows where pg_get_viewdef returned NULL", async () => {
    const mvs = await extractMaterializedViews(
      mockPool([
        {
          ...baseRow,
          name: '"good_mv"',
          definition: "SELECT 1",
        },
        { ...baseRow, name: '"orphan_mv"', definition: null },
      ]),
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
      ),
    ).resolves.toEqual([]);
  });

  test("returns all materialized views when every row has a valid definition", async () => {
    const mvs = await extractMaterializedViews(
      mockPool([
        { ...baseRow, name: '"a"', definition: "SELECT 1" },
        { ...baseRow, name: '"b"', definition: "SELECT 2" },
      ]),
    );
    expect(mvs.map((m) => m.name)).toEqual(['"a"', '"b"']);
  });
});
