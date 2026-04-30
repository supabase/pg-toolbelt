import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { extractTriggers, Trigger } from "./trigger.model.ts";

const baseRow = {
  schema: "public",
  table_name: '"users"',
  table_relkind: "r" as const,
  function_schema: "public",
  function_name: '"my_fn"',
  trigger_type: 7,
  enabled: "O" as const,
  is_internal: false,
  deferrable: false,
  initially_deferred: false,
  argument_count: 0,
  column_numbers: null,
  arguments: [] as string[],
  when_condition: null,
  old_table: null,
  new_table: null,
  is_partition_clone: false,
  parent_trigger_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  is_on_partitioned_table: false,
  owner: "postgres",
  comment: null,
};

const mockPool = (rows: unknown[]): Pool =>
  ({ query: async () => ({ rows }) }) as unknown as Pool;

describe("extractTriggers", () => {
  test("skips rows where pg_get_triggerdef returned NULL", async () => {
    const triggers = await extractTriggers(
      mockPool([
        {
          ...baseRow,
          name: '"good_trg"',
          definition:
            "CREATE TRIGGER good_trg BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION my_fn()",
        },
        { ...baseRow, name: '"orphan_trg"', definition: null },
      ]),
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toBeInstanceOf(Trigger);
    expect(triggers[0]?.name).toBe('"good_trg"');
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractTriggers(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
      ),
    ).resolves.toEqual([]);
  });

  test("returns all triggers when every row has a valid definition", async () => {
    const triggers = await extractTriggers(
      mockPool([
        {
          ...baseRow,
          name: '"a"',
          definition:
            "CREATE TRIGGER a BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION my_fn()",
        },
        {
          ...baseRow,
          name: '"b"',
          definition:
            "CREATE TRIGGER b AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION my_fn()",
        },
      ]),
    );
    expect(triggers.map((t) => t.name)).toEqual(['"a"', '"b"']);
  });
});
