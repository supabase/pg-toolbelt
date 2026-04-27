import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { extractIndexes, Index } from "./index.model.ts";

// Minimal fields required by indexPropsSchema; individual tests override the
// fields relevant to each scenario.
const baseRow = {
  schema: "public",
  table_name: '"users"',
  storage_params: [] as string[],
  statistics_target: [] as number[],
  index_type: "btree",
  tablespace: null,
  is_unique: false,
  is_primary: false,
  is_exclusion: false,
  nulls_not_distinct: false,
  immediate: true,
  is_clustered: false,
  is_replica_identity: false,
  key_columns: [1],
  column_collations: [null],
  operator_classes: ["default"],
  column_options: [0],
  index_expressions: null,
  partial_predicate: null,
  is_owned_by_constraint: false,
  table_relkind: "r" as const,
  is_partitioned_index: false,
  is_index_partition: false,
  parent_index_name: null,
  comment: null,
  owner: "postgres",
};

const mockPool = (rows: unknown[]): Pool =>
  ({ query: async () => ({ rows }) }) as unknown as Pool;

describe("extractIndexes", () => {
  test("skips rows where pg_get_indexdef returned NULL", async () => {
    const indexes = await extractIndexes(
      mockPool([
        {
          ...baseRow,
          name: '"good_idx"',
          definition: "CREATE INDEX good_idx ON users (id)",
        },
        { ...baseRow, name: '"orphan_idx"', definition: null },
      ]),
    );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toBeInstanceOf(Index);
    expect(indexes[0]?.name).toBe('"good_idx"');
    expect(indexes[0]?.definition).toBe("CREATE INDEX good_idx ON users (id)");
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractIndexes(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
      ),
    ).resolves.toEqual([]);
  });

  test("returns all indexes when every row has a valid definition", async () => {
    const indexes = await extractIndexes(
      mockPool([
        {
          ...baseRow,
          name: '"a"',
          definition: "CREATE INDEX a ON users (id)",
        },
        {
          ...baseRow,
          name: '"b"',
          definition: "CREATE INDEX b ON users (id)",
        },
      ]),
    );
    expect(indexes.map((i) => i.name)).toEqual(['"a"', '"b"']);
  });
});
