import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { Range, type RangeProps } from "../range.model.ts";
import { AlterRangeChangeOwner } from "./range.alter.ts";

describe.concurrent("range", () => {
  test("change owner", async () => {
    const base: RangeProps = {
      schema: "public",
      name: "ts_custom",
      owner: "o1",
      subtype_schema: "pg_catalog",
      subtype_str: "int4",
      collation: null,
      canonical_function_schema: null,
      canonical_function_name: null,
      subtype_diff_schema: null,
      subtype_diff_name: null,
      subtype_opclass_schema: null,
      subtype_opclass_name: null,
      comment: null,
      privileges: [],
    };
    const main = new Range(base);
    const change = new AlterRangeChangeOwner({ range: main, owner: "o2" });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe("ALTER TYPE public.ts_custom OWNER TO o2");
  });
});
