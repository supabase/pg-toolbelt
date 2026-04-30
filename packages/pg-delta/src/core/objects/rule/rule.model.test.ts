import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { extractRules, Rule } from "./rule.model.ts";

const baseRow = {
  schema: "public",
  table_name: '"events"',
  relation_kind: "r" as const,
  event: "INSERT" as const,
  enabled: "O" as const,
  is_instead: false,
  owner: "postgres",
  comment: null,
  columns: [] as string[],
};

const mockPool = (rows: unknown[]): Pool =>
  ({ query: async () => ({ rows }) }) as unknown as Pool;

describe("extractRules", () => {
  test("skips rows where pg_get_ruledef returned NULL", async () => {
    const rules = await extractRules(
      mockPool([
        {
          ...baseRow,
          name: '"good_rule"',
          definition:
            "CREATE RULE good_rule AS ON INSERT TO events DO INSTEAD NOTHING;",
        },
        { ...baseRow, name: '"orphan_rule"', definition: null },
      ]),
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toBeInstanceOf(Rule);
    expect(rules[0]?.name).toBe('"good_rule"');
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractRules(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
      ),
    ).resolves.toEqual([]);
  });

  test("returns all rules when every row has a valid definition", async () => {
    const rules = await extractRules(
      mockPool([
        {
          ...baseRow,
          name: '"a"',
          definition: "CREATE RULE a AS ON INSERT TO events DO INSTEAD NOTHING;",
        },
        {
          ...baseRow,
          name: '"b"',
          definition: "CREATE RULE b AS ON UPDATE TO events DO INSTEAD NOTHING;",
        },
      ]),
    );
    expect(rules.map((r) => r.name)).toEqual(['"a"', '"b"']);
  });
});
