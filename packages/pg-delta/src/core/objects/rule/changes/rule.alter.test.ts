import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import { Rule } from "../rule.model.ts";
import { ReplaceRule, SetRuleEnabledState } from "./rule.alter.ts";

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

describe("rule.alter", () => {
  test("replace rule serializes using create or replace and tracks dependencies", async () => {
    const rule = makeRule({ columns: ["id", "amount"] });
    const change = new ReplaceRule({ rule });

    expect(change.requires).toEqual([
      rule.stableId,
      rule.relationStableId,
      ...rule.columns.map((column) =>
        stableId.column(rule.schema, rule.table_name, column),
      ),
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      'CREATE OR REPLACE RULE "my_rule" AS ON INSERT TO public."my_table" DO INSTEAD NOTHING',
    );
  });

  test("set rule enabled state serializes appropriate clause", async () => {
    const rule = makeRule({ columns: ["id", "amount"] });
    const change = new SetRuleEnabledState({ rule, enabled: "D" });

    expect(change.requires).toEqual([
      rule.stableId,
      rule.relationStableId,
      ...rule.columns.map((column) =>
        stableId.column(rule.schema, rule.table_name, column),
      ),
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      'ALTER TABLE public."my_table" DISABLE RULE "my_rule"',
    );
  });

  test("set rule enabled state defaults to rule value and supports views", async () => {
    const rule = makeRule({
      table_name: '"my_view"',
      relation_kind: "v",
      enabled: "R",
      columns: [],
    });

    const change = new SetRuleEnabledState({ rule });

    expect(change.requires).toEqual([rule.stableId, rule.relationStableId]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      'ALTER TABLE public."my_view" ENABLE REPLICA RULE "my_rule"',
    );
  });
});
