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

const mockPoolSequence = (...attempts: unknown[][]): Pool => {
  let i = 0;
  return {
    query: async () => ({
      rows: attempts[Math.min(i++, attempts.length - 1)],
    }),
  } as unknown as Pool;
};

const NO_BACKOFF = { backoffMs: 0 } as const;

describe("extractRules", () => {
  test("skips rows where pg_get_ruledef returned NULL after exhausting retries", async () => {
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
      NO_BACKOFF,
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toBeInstanceOf(Rule);
    expect(rules[0]?.name).toBe('"good_rule"');
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractRules(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
        NO_BACKOFF,
      ),
    ).resolves.toEqual([]);
  });

  test("returns all rules when every row has a valid definition", async () => {
    const rules = await extractRules(
      mockPool([
        {
          ...baseRow,
          name: '"a"',
          definition:
            "CREATE RULE a AS ON INSERT TO events DO INSTEAD NOTHING;",
        },
        {
          ...baseRow,
          name: '"b"',
          definition:
            "CREATE RULE b AS ON UPDATE TO events DO INSTEAD NOTHING;",
        },
      ]),
      NO_BACKOFF,
    );
    expect(rules.map((r) => r.name)).toEqual(['"a"', '"b"']);
  });

  test("recovers when pg_get_ruledef is NULL on first attempt but resolved on retry", async () => {
    const rules = await extractRules(
      mockPoolSequence(
        [{ ...baseRow, name: '"racy_rule"', definition: null }],
        [
          {
            ...baseRow,
            name: '"racy_rule"',
            definition:
              "CREATE RULE racy_rule AS ON INSERT TO events DO INSTEAD NOTHING;",
          },
        ],
      ),
      { retries: 2, backoffMs: 0 },
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('"racy_rule"');
  });
});
