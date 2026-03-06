import { describe, expect, test } from "bun:test";
import { Rule } from "../rule.model.ts";
import { DropRule } from "./rule.drop.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

type RuleProps = ConstructorParameters<typeof Rule>[0];

const base: RuleProps = {
  schema: "public",
  name: '"my_rule"',
  table_name: '"my_table"',
  relation_kind: "r",
  event: "INSERT",
  enabled: "O",
  is_instead: true,
  owner: "owner1",
  definition:
    'CREATE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING',
  comment: null,
  columns: ["id"],
};

const makeRule = (override: Partial<RuleProps> = {}) =>
  new Rule({
    ...base,
    ...override,
    columns: override.columns ? [...override.columns] : [...base.columns],
  });

describe("rule.drop", () => {
  test("serialize rule drop and track dependencies", async () => {
    const rule = makeRule();
    const change = new DropRule({ rule });

    expect(change.drops).toEqual([rule.stableId]);
    expect(change.requires).toEqual([rule.stableId, rule.relationStableId]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe('DROP RULE "my_rule" ON public."my_table"');
  });
});
